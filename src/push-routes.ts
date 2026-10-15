import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { Type } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { PublicError } from "./app.js";
import { ErrorDTO, MutationHeaders } from "./contracts.js";
import { PushRegistrationDTO, PushStatusDTO } from "./push-contracts.js";
import type { ApnsIdentity } from "./apns.js";
import { TaskDTO } from "./task-contracts.js";
import { readTask } from "./tasks.js";
export async function registerPush(
  instance: FastifyInstance,
  ctx: {
    pool: pg.Pool;
    session: (
      authorization?: string,
    ) => Promise<{ ownerId: string; deviceId: string; sessionId: string }>;
    now: () => Date;
    apns?: ApnsIdentity;
  },
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const errors = {
    401: ErrorDTO,
    404: ErrorDTO,
    409: ErrorDTO,
    422: ErrorDTO,
    503: ErrorDTO,
  };
  const params = Type.Object({ id: Type.String({ format: "uuid" }) });
  const security = [{ bearerAuth: [] }];
  async function status(ownerId: string, deviceId: string) {
    const r = (
      await ctx.pool.query(
        "SELECT * FROM push_registration WHERE owner_id=$1 AND device_id=$2 AND topic=$3 AND environment=$4",
        [ownerId, deviceId, ctx.apns?.topic ?? "", ctx.apns?.environment ?? ""],
      )
    ).rows[0];
    return {
      configured: !!ctx.apns,
      topic: ctx.apns?.topic ?? null,
      environment: ctx.apns?.environment ?? null,
      registered: !!r,
      enabled: r?.enabled ?? false,
      authorized: r?.authorized ?? false,
      invalidated: !!r?.invalidated_at,
    };
  }
  app.get(
    "/v1/devices/:id/push",
    {
      schema: { security, params, response: { 200: PushStatusDTO, ...errors } },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization);
      if (identity.deviceId !== req.params.id)
        throw new PublicError(404, "DEVICE_NOT_FOUND", "此设备不存在。");
      return status(identity.ownerId, identity.deviceId);
    },
  );
  app.put(
    "/v1/devices/:id/push",
    {
      schema: {
        security,
        params,
        headers: MutationHeaders,
        body: PushRegistrationDTO,
        response: { 200: PushStatusDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization);
      if (identity.deviceId !== req.params.id)
        throw new PublicError(404, "DEVICE_NOT_FOUND", "此设备不存在。");
      if (!ctx.apns)
        throw new PublicError(
          409,
          "APNS_NOT_CONFIGURED",
          "管理员尚未配置 APNs 身份与密钥。",
        );
      const b = req.body;
      if (b.topic !== ctx.apns.topic || b.environment !== ctx.apns.environment)
        throw new PublicError(
          409,
          "APNS_IDENTITY_MISMATCH",
          "App 的 Bundle ID 或推送环境与服务器不一致，请核对签名配置。",
        );
      const c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
          identity.ownerId,
        ]);
        const auth = await c.query(
          "SELECT s.id FROM session s JOIN device d ON d.owner_id=s.owner_id AND d.id=s.device_id WHERE s.id=$1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
          [identity.sessionId],
        );
        if (!auth.rowCount)
          throw new PublicError(
            401,
            "UNAUTHENTICATED",
            "身份无效，请重新连接。",
          );
        const digest = createHash("sha256")
          .update(
            JSON.stringify([
              b.token.toLowerCase(),
              b.topic,
              b.environment,
              b.enabled,
              b.authorized,
            ]),
          )
          .digest("hex");
        const prior = (
          await c.query(
            "SELECT body_hash FROM push_registration_command WHERE owner_id=$1 AND device_id=$2 AND key=$3",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
            ],
          )
        ).rows[0];
        if (prior && prior.body_hash !== digest)
          throw new PublicError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "相同操作标识的内容不同。",
          );
        if (!prior) {
          await c.query(
            `INSERT INTO push_registration(owner_id,device_id,topic,environment,token,enabled,authorized,registered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,device_id) DO UPDATE SET topic=excluded.topic,environment=excluded.environment,token=excluded.token,enabled=excluded.enabled,authorized=excluded.authorized,registered_at=excluded.registered_at,invalidated_at=NULL`,
            [
              identity.ownerId,
              identity.deviceId,
              b.topic,
              b.environment,
              b.token.toLowerCase(),
              b.enabled,
              b.authorized,
              ctx.now(),
            ],
          );
          await c.query(
            "INSERT INTO push_registration_command(owner_id,device_id,key,body_hash) VALUES($1,$2,$3,$4)",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
              digest,
            ],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      return status(identity.ownerId, identity.deviceId);
    },
  );
  app.delete(
    "/v1/devices/:id/push",
    {
      schema: {
        security,
        params,
        headers: MutationHeaders,
        response: { 200: PushStatusDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization);
      if (identity.deviceId !== req.params.id)
        throw new PublicError(404, "DEVICE_NOT_FOUND", "此设备不存在。");
      const c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
          identity.ownerId,
        ]);
        const auth = await c.query(
          "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id WHERE s.id=$1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
          [identity.sessionId],
        );
        if (!auth.rowCount)
          throw new PublicError(
            401,
            "UNAUTHENTICATED",
            "身份无效，请重新连接。",
          );
        const previous = (
          await c.query(
            "SELECT body_hash FROM push_registration_command WHERE owner_id=$1 AND device_id=$2 AND key=$3",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
            ],
          )
        ).rows[0];
        if (previous && previous.body_hash !== "disable")
          throw new PublicError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "相同操作标识的内容不同。",
          );
        if (!previous) {
          await c.query(
            "UPDATE push_registration SET enabled=false WHERE owner_id=$1 AND device_id=$2",
            [identity.ownerId, identity.deviceId],
          );
          await c.query(
            "INSERT INTO push_registration_command(owner_id,device_id,key,body_hash) VALUES($1,$2,$3,'disable')",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
            ],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      return status(identity.ownerId, identity.deviceId);
    },
  );
  app.post(
    "/v1/tasks/:id/remote-confirmation",
    {
      schema: {
        security,
        params,
        headers: MutationHeaders,
        body: Type.Object(
          {
            occurrenceId: Type.String({ format: "uuid" }),
            reminderRevision: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
        response: { 200: TaskDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization),
        c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
          identity.ownerId,
        ]);
        const auth = await c.query(
          "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id WHERE s.id=$1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
          [identity.sessionId],
        );
        if (!auth.rowCount)
          throw new PublicError(
            401,
            "UNAUTHENTICATED",
            "身份无效，请重新连接。",
          );
        const result = await c.query(
          `UPDATE remote_occurrence o SET quiet_hours_confirmed=true FROM reminder r JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id WHERE o.id=$1 AND o.owner_id=$2 AND o.device_id=$3 AND r.id=o.reminder_id AND r.owner_id=o.owner_id AND r.task_id=$4 AND r.revision=o.reminder_revision AND o.reminder_revision=$5 AND r.active AND t.status='active' AND o.status='planned' RETURNING r.id`,
          [
            req.body.occurrenceId,
            identity.ownerId,
            identity.deviceId,
            req.params.id,
            req.body.reminderRevision,
          ],
        );
        if (!result.rowCount)
          throw new PublicError(409, "STALE_PLAN", "提醒已更新，请刷新。");
        await c.query(
          "UPDATE reminder SET scheduling_status='remote_planned' WHERE id=$1",
          [result.rows[0].id],
        );
        const task = await readTask(c, identity.ownerId, req.params.id);
        await c.query("COMMIT");
        return task;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  );
}

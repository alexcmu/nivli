import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { Type } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  PlaceDTO,
  PlaceFields,
  LocationPlanDTO,
} from "./location-contracts.js";
import { placeDTO } from "./location-store.js";
import { PublicError } from "./app.js";
import { MutationHeaders, ErrorDTO } from "./contracts.js";
import { readTask } from "./tasks.js";
import { isQuiet } from "./quiet-hours.js";
export async function registerLocations(
  instance: FastifyInstance,
  ctx: {
    pool: pg.Pool;
    session: (
      authorization?: string,
    ) => Promise<{ ownerId: string; deviceId: string; sessionId: string }>;
    now: () => Date;
  },
) {
  const canonical = (v: unknown): string =>
    v !== null && typeof v === "object"
      ? Array.isArray(v)
        ? "[" + v.map(canonical).join(",") + "]"
        : "{" +
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
            .join(",") +
          "}"
      : JSON.stringify(v);
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const uuid = Type.String({ format: "uuid" }),
    params = Type.Object({ id: uuid });
  const security = [{ bearerAuth: [] }],
    errors = {
      401: ErrorDTO,
      404: ErrorDTO,
      409: ErrorDTO,
      422: ErrorDTO,
      503: ErrorDTO,
    };
  async function mutate<T>(
    identity: Awaited<ReturnType<typeof ctx.session>>,
    key: string,
    body: unknown,
    work: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await ctx.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
        identity.ownerId,
      ]);
      if (
        !(
          await c.query(
            "SELECT s.id FROM session s JOIN device d ON d.owner_id=s.owner_id AND d.id=s.device_id WHERE s.id=$1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
            [identity.sessionId],
          )
        ).rowCount
      )
        throw new PublicError(401, "UNAUTHENTICATED", "请重新连接。");
      const digest = createHash("sha256").update(canonical(body)).digest("hex");
      const prior = (
        await c.query(
          "SELECT * FROM location_command WHERE owner_id=$1 AND device_id=$2 AND key=$3",
          [identity.ownerId, identity.deviceId, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.body_hash !== digest)
          throw new PublicError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "相同操作标识的内容不同。",
          );
        await c.query("COMMIT");
        return prior.result;
      }
      const result = await work(c);
      await c.query(
        "INSERT INTO location_command(owner_id,device_id,key,body_hash,result) VALUES($1,$2,$3,$4,$5)",
        [identity.ownerId, identity.deviceId, key, digest, result],
      );
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      if ((e as { code?: string }).code === "23505")
        throw new PublicError(
          409,
          "PLACE_NAME_EXISTS",
          "已有同名地点，请使用不同名称。",
        );
      throw e;
    } finally {
      c.release();
    }
  }
  app.get(
    "/v1/places",
    {
      schema: {
        security,
        response: {
          200: Type.Object({ places: Type.Array(PlaceDTO) }),
          ...errors,
        },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return {
        places: (
          await ctx.pool.query(
            "SELECT * FROM place WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY name,id",
            [i.ownerId],
          )
        ).rows.map(placeDTO),
      };
    },
  );
  app.post(
    "/v1/places",
    {
      schema: {
        security,
        headers: MutationHeaders,
        body: Type.Object(
          { id: uuid, ...PlaceFields },
          { additionalProperties: false },
        ),
        response: { 200: PlaceDTO, ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return mutate(
        i,
        req.headers["idempotency-key"],
        ["create", req.body],
        async (c) => {
          if (!req.body.name.trim())
            throw new PublicError(422, "INVALID_NAME", "请输入地点名称。");
          const p = (
            await c.query(
              "INSERT INTO place(id,owner_id,name,latitude,longitude,radius) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                req.body.id,
                i.ownerId,
                req.body.name.trim(),
                req.body.latitude,
                req.body.longitude,
                req.body.radius,
              ],
            )
          ).rows[0];
          return placeDTO(p);
        },
      );
    },
  );
  const impact = async (c: Pick<pg.Pool, "query">, owner: string, id: string) =>
    (
      await c.query(
        "SELECT t.id,t.title FROM task t JOIN reminder r ON r.owner_id=t.owner_id AND r.task_id=t.id JOIN location_plan l ON l.owner_id=r.owner_id AND l.reminder_id=r.id AND l.reminder_revision=r.revision WHERE t.owner_id=$1 AND l.place_id=$2 AND r.active AND t.status='active' ORDER BY t.id",
        [owner, id],
      )
    ).rows;
  app.get(
    "/v1/places/:id/impact",
    {
      schema: {
        security,
        params,
        response: {
          200: Type.Object({
            tasks: Type.Array(Type.Object({ id: uuid, title: Type.String() })),
          }),
          ...errors,
        },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      if (
        !(
          await ctx.pool.query(
            "SELECT id FROM place WHERE owner_id=$1 AND id=$2",
            [i.ownerId, req.params.id],
          )
        ).rowCount
      )
        throw new PublicError(404, "PLACE_NOT_FOUND", "此地点不存在。");
      return { tasks: await impact(ctx.pool, i.ownerId, req.params.id) };
    },
  );
  const changeBody = Type.Object(
    {
      expectedRevision: Type.Integer({ minimum: 1 }),
      expectedAffectedTaskIds: Type.Array(uuid),
      ...PlaceFields,
    },
    { additionalProperties: false },
  );
  async function change(
    c: pg.PoolClient,
    owner: string,
    id: string,
    revision: number,
    expectedAffected: string[],
    fields?: {
      name: string;
      latitude: number;
      longitude: number;
      radius: number;
    },
  ) {
    const p = (
      await c.query(
        "SELECT * FROM place WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
        [owner, id],
      )
    ).rows[0];
    if (!p) throw new PublicError(404, "PLACE_NOT_FOUND", "此地点不存在。");
    if (p.revision !== revision)
      throw new PublicError(
        409,
        "PLACE_CHANGED",
        "地点已被修改，请刷新后核对。",
      );
    if (fields && !fields.name.trim())
      throw new PublicError(422, "INVALID_NAME", "请输入地点名称。");
    const affected = await impact(c, owner, id);
    if (
      canonical(affected.map((t) => t.id).sort()) !==
      canonical([...new Set(expectedAffected)].sort())
    )
      throw new PublicError(
        409,
        "PLACE_IMPACT_CHANGED",
        "关联事项已变化，请重新查看受影响提醒后确认。",
      );
    if (fields)
      await c.query(
        "UPDATE place SET revision=revision+1,name=$3,latitude=$4,longitude=$5,radius=$6 WHERE owner_id=$1 AND id=$2",
        [
          owner,
          id,
          fields.name.trim(),
          fields.latitude,
          fields.longitude,
          fields.radius,
        ],
      );
    else
      await c.query(
        "UPDATE place SET revision=revision+1,deleted_at=$3 WHERE owner_id=$1 AND id=$2",
        [owner, id, ctx.now()],
      );
    await c.query(
      "UPDATE remote_occurrence SET status='cancelled' WHERE owner_id=$1 AND status='planned' AND reminder_id IN(SELECT reminder_id FROM location_plan WHERE owner_id=$1 AND place_id=$2)",
      [owner, id],
    );
    await c.query(
      "UPDATE location_plan l SET installation_status='needs_configuration' FROM reminder r WHERE l.owner_id=$1 AND l.place_id=$2 AND r.owner_id=l.owner_id AND r.id=l.reminder_id AND r.revision=l.reminder_revision AND r.active",
      [owner, id],
    );
    await c.query(
      "UPDATE task SET revision=revision+1,updated_at=$3 WHERE owner_id=$1 AND id IN(SELECT r.task_id FROM reminder r JOIN location_plan l ON l.owner_id=r.owner_id AND l.reminder_id=r.id AND l.reminder_revision=r.revision WHERE r.owner_id=$1 AND r.active AND l.place_id=$2)",
      [owner, id, ctx.now()],
    );
    return {
      affectedTaskIds: affected.map((t) => t.id),
      deviceCleanup: "pending" as const,
    };
  }
  const changeResponse = Type.Object({
    affectedTaskIds: Type.Array(uuid),
    deviceCleanup: Type.Literal("pending"),
  });
  app.put(
    "/v1/places/:id",
    {
      schema: {
        security,
        params,
        headers: MutationHeaders,
        body: changeBody,
        response: { 200: changeResponse, ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return mutate(
        i,
        req.headers["idempotency-key"],
        ["edit", req.params.id, req.body],
        (c) =>
          change(
            c,
            i.ownerId,
            req.params.id,
            req.body.expectedRevision,
            req.body.expectedAffectedTaskIds,
            req.body,
          ),
      );
    },
  );
  app.delete(
    "/v1/places/:id",
    {
      schema: {
        security,
        params,
        headers: MutationHeaders,
        body: Type.Object(
          {
            expectedRevision: Type.Integer({ minimum: 1 }),
            expectedAffectedTaskIds: Type.Array(uuid),
          },
          { additionalProperties: false },
        ),
        response: { 200: changeResponse, ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return mutate(
        i,
        req.headers["idempotency-key"],
        ["delete", req.params.id, req.body],
        (c) =>
          change(
            c,
            i.ownerId,
            req.params.id,
            req.body.expectedRevision,
            req.body.expectedAffectedTaskIds,
          ),
      );
    },
  );
  app.get(
    "/v1/location-plans",
    {
      schema: {
        security,
        response: {
          200: Type.Object({ plans: Type.Array(LocationPlanDTO) }),
          ...errors,
        },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      const rows = (
        await ctx.pool.query(
          "SELECT r.task_id FROM reminder r JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id JOIN location_plan l ON l.owner_id=r.owner_id AND l.reminder_id=r.id AND l.reminder_revision=r.revision WHERE r.owner_id=$1 AND l.device_id=$2 AND r.active AND t.status='active' ORDER BY l.id",
          [i.ownerId, i.deviceId],
        )
      ).rows;
      const plans = [];
      for (const r of rows) {
        const t = await readTask(ctx.pool, i.ownerId, r.task_id);
        if (t.locationReminder) plans.push(t.locationReminder);
      }
      return { plans };
    },
  );
  const authority = {
    planId: uuid,
    reminderRevision: Type.Integer({ minimum: 1 }),
  };
  async function current(
    c: pg.PoolClient,
    i: { ownerId: string; deviceId: string },
    planId: string,
    revision: number,
  ) {
    const l = (
      await c.query(
        "SELECT l.*,r.time_zone,r.task_id,r.revision,r.active,t.status AS task_status,p.revision AS current_place_revision,p.deleted_at FROM location_plan l JOIN reminder r ON r.owner_id=l.owner_id AND r.id=l.reminder_id JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id JOIN place p ON p.owner_id=l.owner_id AND p.id=l.place_id WHERE l.owner_id=$1 AND l.device_id=$2 AND l.id=$3 FOR UPDATE OF l,r",
        [i.ownerId, i.deviceId, planId],
      )
    ).rows[0];
    if (!l) throw new PublicError(404, "PLAN_NOT_FOUND", "此地点提醒不存在。");
    if (
      !l.active ||
      l.task_status !== "active" ||
      l.revision !== revision ||
      l.reminder_revision !== revision ||
      l.current_place_revision !== l.place_revision ||
      l.deleted_at ||
      l.installation_status === "needs_configuration"
    )
      throw new PublicError(
        409,
        "STALE_PLAN",
        "地点或事项已修改，旧范围不会再触发提醒。",
      );
    return l;
  }
  app.post(
    "/v1/location-plans/receipts",
    {
      schema: {
        security,
        headers: MutationHeaders,
        body: Type.Object(
          {
            ...authority,
            status: Type.Union(
              [
                "monitoring",
                "permission_denied",
                "unavailable",
                "capacity",
              ].map((x) => Type.Literal(x)),
            ),
          },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ recorded: Type.Boolean() }), ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return mutate(
        i,
        req.headers["idempotency-key"],
        ["receipt", req.body],
        async (c) => {
          const l = await current(
            c,
            i,
            req.body.planId,
            req.body.reminderRevision,
          );
          if (!l.triggered_at)
            await c.query(
              "UPDATE location_plan SET installation_status=$2 WHERE id=$1",
              [l.id, req.body.status],
            );
          if (req.body.status !== "monitoring")
            await c.query(
              "UPDATE remote_occurrence SET status='cancelled' WHERE owner_id=$1 AND reminder_id=$2 AND status='planned'",
              [i.ownerId, l.reminder_id],
            );
          return { recorded: true };
        },
      );
    },
  );
  app.post(
    "/v1/location-events",
    {
      schema: {
        security,
        headers: MutationHeaders,
        body: Type.Object(
          {
            ...authority,
            transition: Type.Union([
              Type.Literal("enter"),
              Type.Literal("exit"),
            ]),
            observedAt: Type.String({ format: "date-time" }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ recorded: Type.Boolean(), status: Type.String() }),
          ...errors,
        },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return mutate(
        i,
        req.headers["idempotency-key"],
        ["event", req.body],
        async (c) => {
          const l = await current(
            c,
            i,
            req.body.planId,
            req.body.reminderRevision,
          );
          if (l.transition !== req.body.transition)
            throw new PublicError(
              409,
              "WRONG_TRANSITION",
              "区域事件与提醒条件不符。",
            );
          if (l.triggered_at)
            return { recorded: true, status: "already_recorded" };
          if (l.installation_status !== "monitoring")
            throw new PublicError(
              409,
              "LOCATION_NOT_READY",
              "地点监测尚未就绪。",
            );
          const observed = new Date(req.body.observedAt),
            now = ctx.now();
          if (
            observed.getTime() > now.getTime() + 60000 ||
            observed.getTime() < now.getTime() - 900000
          )
            throw new PublicError(
              422,
              "EVENT_EXPIRED",
              "地点事件已过期，不会补发旧通知。",
            );
          const confirmed =
            !isQuiet(observed.toISOString(), l.time_zone) ||
            l.quiet_hours_confirmed;
          let expires = new Date(observed.getTime() + 900000);
          const deadline = (
            await c.query(
              "SELECT deadline FROM task WHERE owner_id=$1 AND id=$2",
              [i.ownerId, l.task_id],
            )
          ).rows[0].deadline;
          if (deadline?.kind === "instant") {
            const d = new Date(deadline.instant);
            if (d > observed && d < expires) expires = d;
          }
          await c.query(
            "UPDATE location_plan SET triggered_at=$2,installation_status='triggered' WHERE id=$1",
            [l.id, observed],
          );
          await c.query(
            "INSERT INTO remote_occurrence(id,owner_id,device_id,reminder_id,reminder_revision,quiet_hours_confirmed,scheduled_at,expires_at,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
            [
              randomUUID(),
              i.ownerId,
              i.deviceId,
              l.reminder_id,
              l.reminder_revision,
              confirmed,
              observed,
              expires,
              now,
            ],
          );
          await c.query(
            "UPDATE reminder SET scheduling_status=$2 WHERE id=$1",
            [
              l.reminder_id,
              confirmed ? "remote_planned" : "needs_confirmation",
            ],
          );
          return {
            recorded: true,
            status: confirmed ? "remote_planned" : "needs_confirmation",
          };
        },
      );
    },
  );
}

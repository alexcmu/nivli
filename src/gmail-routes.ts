import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { MutationHeaders, ErrorDTO } from "./contracts.js";
import {
  GmailProvider,
  tokenVault,
  digest,
  GmailFailure,
  type GmailConfig,
} from "./gmail.js";
export const GmailConsentDTO = Type.Object(
  {
    labelIds: Type.Array(Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" }), {
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
    }),
    initialDays: Type.Integer({ minimum: 0, maximum: 7, default: 7 }),
    retentionDays: Type.Integer({ minimum: 1, maximum: 7, default: 7 }),
    confirmed: Type.Literal(true),
    expectedRevision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const GmailStatusDTO = Type.Object({
  configured: Type.Boolean(),
  state: Type.Union(
    ["stopped", "active", "reauthorization_required"].map((v) =>
      Type.Literal(v),
    ),
  ),
  account: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Integer(),
  labelIds: Type.Array(Type.String()),
  initialDays: Type.Integer(),
  retentionDays: Type.Integer(),
  lastSuccessfulSync: Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ]),
  syncError: Type.Union([Type.String(), Type.Null()]),
  nextSyncAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  pollIntervalMinutes: Type.Literal(5),
  modelDataDestination: Type.String(),
});
const revisionDTO = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export interface GmailDependencies {
  pool: pg.Pool;
  session: (
    authorization?: string,
  ) => Promise<{ ownerId: string; sessionId: string; deviceId: string }>;
  gmail?: GmailConfig;
  publicUrl: string;
  modelDataDestination: string;
  clock?: () => Date;
}
export async function registerGmail(
  app: FastifyInstance,
  deps: GmailDependencies,
) {
  const { pool } = deps,
    now = () => deps.clock?.() ?? new Date();
  const provider = deps.gmail
    ? new GmailProvider(deps.gmail, deps.publicUrl + "/v1/gmail/oauth/callback")
    : undefined;
  const vault = deps.gmail ? tokenVault(deps.gmail.tokenKey) : undefined;
  const errors = {
    401: ErrorDTO,
    409: ErrorDTO,
    422: ErrorDTO,
    429: ErrorDTO,
    503: ErrorDTO,
  };
  const fail = (status: number, code: string, message: string) =>
    Object.assign(new Error(message), {
      statusCode: status,
      code,
      publicFailure: true,
    });
  // Route errors explicitly carry public messages; provider errors never carry its response bodies.
  const status = async (owner: string) => {
    const r = await pool.query("SELECT * FROM gmail_source WHERE owner_id=$1", [
      owner,
    ]);
    const s = r.rows[0];
    return {
      configured: !!provider,
      state: s?.state ?? "stopped",
      account: s?.account ?? null,
      revision: s?.revision ?? 0,
      labelIds: s?.label_ids ?? [],
      initialDays: s?.initial_days ?? 7,
      retentionDays: s?.retention_days ?? 7,
      lastSuccessfulSync: s?.last_successful_sync?.toISOString() ?? null,
      syncError: s?.sync_error ?? null,
      nextSyncAt: s?.next_sync_at?.toISOString() ?? null,
      pollIntervalMinutes: 5 as const,
      modelDataDestination: deps.modelDataDestination,
    };
  };
  const mutation = async (
    req: { headers: Record<string, unknown>; body?: unknown },
    kind: string,
    work: (
      tx: pg.PoolClient,
      identity: { ownerId: string; sessionId: string; deviceId: string },
    ) => Promise<unknown>,
  ) => {
    const identity = await deps.session(req.headers.authorization as string);
    const key = req.headers["idempotency-key"] as string;
    const hash = digest(JSON.stringify(req.body ?? {}));
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
        identity.ownerId,
      ]);
      const active = await tx.query(
        "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id WHERE s.id=$1 AND s.owner_id=$2 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.access_expires_at>$3",
        [identity.sessionId, identity.ownerId, now()],
      );
      if (!active.rowCount) throw fail(401, "UNAUTHENTICATED", "请重新连接。");
      const previous = await tx.query(
        "SELECT * FROM gmail_operation WHERE owner_id=$1 AND key=$2",
        [identity.ownerId, key],
      );
      let result;
      if (previous.rowCount) {
        const p = previous.rows[0];
        if (p.kind !== kind || p.digest !== hash)
          throw fail(409, "IDEMPOTENCY_CONFLICT", "操作内容不同。");
        result = p.result;
        if (kind === "connect") {
          const auth = await tx.query(
            "SELECT state_hash FROM gmail_oauth WHERE state_hash=$1 AND source_revision=(SELECT revision FROM gmail_source WHERE owner_id=$2) AND expires_at>$3 AND consumed_at IS NULL",
            [
              digest(
                new URL(result.authorizationUrl).searchParams.get("state")!,
              ),
              identity.ownerId,
              now(),
            ],
          );
          if (!auth.rowCount)
            throw fail(
              409,
              "AUTHORIZATION_EXPIRED",
              "授权操作已失效，请重新发起。",
            );
        }
      } else {
        result = await work(tx, identity);
        await tx.query(
          "INSERT INTO gmail_operation(owner_id,key,kind,digest,result) VALUES($1,$2,$3,$4,$5)",
          [identity.ownerId, key, kind, hash, JSON.stringify(result)],
        );
      }
      await tx.query("COMMIT");
      return result;
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  };
  const secure = { security: [{ bearerAuth: [] }] };
  app.get(
    "/v1/gmail",
    { schema: { ...secure, response: { 200: GmailStatusDTO, ...errors } } },
    async (req) =>
      status((await deps.session(req.headers.authorization)).ownerId),
  );
  app.post<{
    Body: Static<typeof GmailConsentDTO>;
    Headers: Static<typeof MutationHeaders>;
  }>(
    "/v1/gmail/connect",
    {
      schema: {
        ...secure,
        headers: MutationHeaders,
        body: GmailConsentDTO,
        response: {
          200: Type.Object({
            authorizationUrl: Type.String({ format: "uri" }),
            expiresAt: Type.String({ format: "date-time" }),
          }),
          ...errors,
        },
      },
    },
    async (req) =>
      mutation(req, "connect", async (tx, id) => {
        if (!provider)
          throw fail(
            503,
            "GMAIL_NOT_CONFIGURED",
            "管理员尚未配置 Gmail OAuth。",
          );
        await tx.query(
          "INSERT INTO gmail_source(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
          [id.ownerId],
        );
        const r = await tx.query(
          "SELECT revision FROM gmail_source WHERE owner_id=$1 FOR UPDATE",
          [id.ownerId],
        );
        if (r.rows[0].revision !== req.body.expectedRevision)
          throw fail(409, "REVISION_CONFLICT", "来源已改变，请刷新。");
        await tx.query("DELETE FROM gmail_oauth WHERE owner_id=$1", [
          id.ownerId,
        ]);
        const state = randomBytes(32).toString("base64url"),
          expiresAt = new Date(now().getTime() + 600000);
        await tx.query(
          "INSERT INTO gmail_oauth(state_hash,owner_id,session_id,source_revision,consent,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            digest(state),
            id.ownerId,
            id.sessionId,
            req.body.expectedRevision,
            JSON.stringify(req.body),
            expiresAt,
          ],
        );
        return {
          authorizationUrl: provider.authorization(state),
          expiresAt: expiresAt.toISOString(),
        };
      }),
  );
  app.get<{ Querystring: { state: string; code?: string; error?: string } }>(
    "/v1/gmail/oauth/callback",
    {
      schema: {
        querystring: Type.Object({
          state: Type.String({ minLength: 20, maxLength: 200 }),
          code: Type.Optional(Type.String({ maxLength: 4096 })),
          error: Type.Optional(Type.String({ maxLength: 200 })),
        }),
        response: errors,
      },
    },
    async (req, reply) => {
      if (!provider || !vault)
        return reply
          .code(503)
          .send({
            code: "GMAIL_NOT_CONFIGURED",
            message: "Gmail 尚未配置。",
            requestId: req.id,
            retryable: false,
          });
      const reject = () =>
        reply
          .code(401)
          .send({
            code: "OAUTH_REJECTED",
            message: "授权已失效，请从应用重新开始。",
            requestId: req.id,
            retryable: false,
          });
      const binding = await pool.query(
        "UPDATE gmail_oauth SET consumed_at=$2 WHERE state_hash=$1 AND expires_at>$2 AND consumed_at IS NULL RETURNING *",
        [digest(req.query.state), now()],
      );
      if (!binding.rowCount) return reject();
      const b = binding.rows[0];
      if (req.query.error || !req.query.code)
        return reply.redirect("nivli://gmail?result=cancelled", 303);
      try {
        const tokens = await provider.exchange(req.query.code);
        const profile = await provider.get<{
          emailAddress: string;
          historyId: string;
        }>(tokens, "profile");
        if (
          typeof profile.emailAddress !== "string" ||
          !profile.emailAddress.includes("@") ||
          typeof profile.historyId !== "string" ||
          !/^\d+$/.test(profile.historyId)
        )
          return reject();
        const tx = await pool.connect();
        try {
          await tx.query("BEGIN");
          await tx.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
            b.owner_id,
          ]);
          const s = await tx.query(
            "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id WHERE s.id=$1 AND s.owner_id=$2 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.access_expires_at>$3",
            [b.session_id, b.owner_id, now()],
          );
          if (!s.rowCount) {
            await tx.query("ROLLBACK");
            return reject();
          }
          const current = await tx.query(
            "SELECT state_hash FROM gmail_oauth WHERE state_hash=$1 AND session_id=$2 AND expires_at>$3 AND consumed_at IS NOT NULL",
            [b.state_hash, b.session_id, now()],
          );
          if (!current.rowCount) {
            await tx.query("ROLLBACK");
            return reject();
          }
          const c = b.consent as Static<typeof GmailConsentDTO>;
          const after = new Date(now().getTime() - c.initialDays * 86400000);
          const r = await tx.query(
            `UPDATE gmail_source SET account=$3,state='active',revision=revision+1,label_ids=$4,initial_days=$5,retention_days=$6,authorized_after=$7,encrypted_tokens=$8,history_id=$9,scan=NULL,last_successful_sync=NULL,sync_error=NULL,failures=0,next_sync_at=$10,lease_until=NULL WHERE owner_id=$1 AND revision=$2 AND (account IS NULL OR account=$3) RETURNING revision`,
            [
              b.owner_id,
              b.source_revision,
              profile.emailAddress,
              JSON.stringify(c.labelIds),
              c.initialDays,
              c.retentionDays,
              after,
              vault.seal(tokens),
              c.initialDays === 0 ? profile.historyId : null,
              now(),
            ],
          );
          if (!r.rowCount) {
            await tx.query("ROLLBACK");
            return reject();
          }
          await tx.query("COMMIT");
          return reply.redirect("nivli://gmail?result=connected", 303);
        } catch (e) {
          await tx.query("ROLLBACK");
          throw e;
        } finally {
          tx.release();
        }
      } catch {
        return reply.redirect("nivli://gmail?result=failed", 303);
      }
    },
  );
  for (const kind of ["refresh", "stop"] as const) {
    app.post<{
      Body: Static<typeof revisionDTO>;
      Headers: Static<typeof MutationHeaders>;
    }>(
      `/v1/gmail/${kind}`,
      {
        schema: {
          ...secure,
          headers: MutationHeaders,
          body: revisionDTO,
          response: {
            200: Type.Object({ accepted: Type.Boolean() }),
            ...errors,
          },
        },
      },
      async (req) =>
        mutation(req, kind, async (tx, id) => {
          const r = await tx.query(
            "SELECT * FROM gmail_source WHERE owner_id=$1 FOR UPDATE",
            [id.ownerId],
          );
          const s = r.rows[0];
          if (!s || s.revision !== req.body.expectedRevision)
            throw fail(409, "REVISION_CONFLICT", "来源已改变，请刷新。");
          if (kind === "stop") {
            await tx.query(
              "UPDATE gmail_source SET state='stopped',revision=revision+1,encrypted_tokens=NULL,scan=NULL,next_sync_at=NULL,lease_until=NULL WHERE owner_id=$1",
              [id.ownerId],
            );
            await tx.query("DELETE FROM gmail_oauth WHERE owner_id=$1", [
              id.ownerId,
            ]);
          } else {
            if (s.state !== "active")
              throw fail(409, "REAUTH_REQUIRED", "请重新授权。");
            if (
              s.requested_at &&
              now().getTime() - s.requested_at.getTime() < 60000
            )
              throw fail(429, "RATE_LIMITED", "请稍后刷新。");
            await tx.query(
              "UPDATE gmail_source SET next_sync_at=$2,requested_at=$2 WHERE owner_id=$1",
              [id.ownerId, now()],
            );
          }
          return { accepted: true };
        }),
    );
  }
  // Retained items are inspectable metadata only; source authorization is checked for every read.
  app.get(
    "/v1/gmail/items",
    {
      schema: {
        ...secure,
        response: {
          200: Type.Object({
            items: Type.Array(
              Type.Object({
                id: Type.String(),
                messageId: Type.String(),
                contentVersion: Type.String(),
                receivedAt: Type.String(),
                contentAvailable: Type.Boolean(),
              }),
            ),
          }),
          ...errors,
        },
      },
    },
    async (req) => {
      const id = await deps.session(req.headers.authorization);
      const r = await pool.query(
        "SELECT i.id,i.message_id,i.content_version,i.received_at,(i.encrypted_content IS NOT NULL AND i.expires_at>$2) AS content_available FROM gmail_source_item i JOIN gmail_source s ON s.owner_id=i.owner_id AND s.account=i.account WHERE i.owner_id=$1 AND s.state='active' AND i.authorization_revision=s.revision ORDER BY i.received_at DESC LIMIT 100",
        [id.ownerId, now()],
      );
      return {
        items: r.rows.map((i) => ({
          id: i.id,
          messageId: i.message_id,
          contentVersion: i.content_version,
          receivedAt: i.received_at.toISOString(),
          contentAvailable: i.content_available,
        })),
      };
    },
  );
}

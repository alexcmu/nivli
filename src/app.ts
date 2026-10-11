import Fastify, { LogController } from "fastify";
import swagger from "@fastify/swagger";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { sql } from "drizzle-orm";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { connect, verifySchema } from "./database.js";
import {
  ErrorDTO,
  EnvironmentDTO,
  SessionDTO,
  CredentialsDTO,
  ClaimDTO,
  RenewDTO,
  MutationHeaders,
} from "./contracts.js";
import { registerGmail } from "./gmail-routes.js";
import type { GmailConfig } from "./gmail.js";
export interface Config {
  gmail?: GmailConfig;
  databaseUrl: string;
  adminSecret: string;
  publicUrl: string;
  environmentName: string;
  pushMode: "self_signed" | "disabled" | "relay";
  modelDataDestination: string;
  clock?: () => Date;
  logger?: boolean;
  logStream?: { write: (message: string) => void };
  pairingTtlSeconds?: number;
}
class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const unauthorized = () =>
  new PublicError(401, "UNAUTHENTICATED", "身份无效，请重新连接。");
const capabilities = ["pairing", "session"];
export async function createApp(config: Config) {
  if (
    config.pairingTtlSeconds !== undefined &&
    (!Number.isInteger(config.pairingTtlSeconds) ||
      config.pairingTtlSeconds < 1 ||
      config.pairingTtlSeconds > 600)
  )
    throw new Error("Pairing TTL must be between 1 and 600 seconds");
  if (config.adminSecret.length < 32)
    throw new Error("Administrator secret must contain at least 32 characters");
  const url = new URL(config.publicUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("PUBLIC_URL must be an HTTPS origin");
  await verifySchema(config.databaseUrl);
  const { pool, db } = connect(config.databaseUrl);
  const now = () => config.clock?.() ?? new Date();
  const key = Buffer.from(hash(config.adminSecret), "hex");
  const seal = (value: unknown) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  };
  const unseal = (value: string) => {
    const buf = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    cipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(buf.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  };
  const app = Fastify({
    logger: config.logger
      ? {
          stream: config.logStream,
          serializers: {
            req: (r) => ({ method: r.method }),
            res: (r) => ({ statusCode: r.statusCode }),
          },
          redact: ["req.headers", "req.body", "err"],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 4096,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();
  await app.register(swagger, {
    openapi: {
      info: { title: "Nivli identity API", version: "0.1.0" },
      servers: [{ url: config.publicUrl }],
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    },
  });
  app.addHook("onClose", async () => {
    await pool.end();
  });
  app.setErrorHandler((error, request, reply) => {
    const e =
      error instanceof PublicError
        ? error
        : error instanceof Error &&
            "publicFailure" in error &&
            "statusCode" in error &&
            "code" in error &&
            typeof error.code === "string"
          ? new PublicError(Number(error.statusCode), error.code, error.message)
          : typeof error === "object" &&
              error !== null &&
              ("validation" in error ||
                ("statusCode" in error && Number(error.statusCode) < 500))
            ? new PublicError(422, "INVALID_INPUT", "输入格式不正确。")
            : new PublicError(
                503,
                "SERVICE_UNAVAILABLE",
                "服务暂时不可用，请重试。",
                true,
              );
    reply.code(e.status).send({
      code: e.code,
      message: e.message,
      requestId: request.id,
      retryable: e.retryable,
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      message: "此入口不可用。",
      requestId: req.id,
      retryable: false,
    }),
  );
  const errors = {
    401: ErrorDTO,
    403: ErrorDTO,
    404: ErrorDTO,
    409: ErrorDTO,
    410: ErrorDTO,
    422: ErrorDTO,
    429: ErrorDTO,
    503: ErrorDTO,
  };
  const admin = (authorization?: string) => {
    const supplied = hash(authorization ?? "");
    if (
      !timingSafeEqual(
        Buffer.from(supplied),
        Buffer.from(hash(`Bearer ${config.adminSecret}`)),
      )
    )
      throw unauthorized();
  };
  const rate = async (bucket: string) => {
    const time = now();
    const result = await db.execute(
      sql`INSERT INTO rate_limit(bucket,window_start,attempts) VALUES (${bucket},${time},1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN rate_limit.window_start <= ${new Date(time.getTime() - 60000)} THEN 1 ELSE rate_limit.attempts+1 END,window_start=CASE WHEN rate_limit.window_start <= ${new Date(time.getTime() - 60000)} THEN ${time} ELSE rate_limit.window_start END RETURNING attempts`,
    );
    if (Number(result.rows[0]?.attempts) > 10)
      throw new PublicError(
        429,
        "RATE_LIMITED",
        "尝试过多，请稍后重试。",
        true,
      );
  };
  const session = async (authorization?: string, revokeReplay = false) => {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const r = await db.execute(
      sql`SELECT s.id as "sessionId",s.owner_id as "ownerId",s.device_id as "deviceId" FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.access_hash=${hash(token)} AND (${revokeReplay} OR (s.revoked_at IS NULL AND d.revoked_at IS NULL)) AND s.access_expires_at>${now()} AND s.refresh_expires_at>${now()}`,
    );
    if (!r.rows[0]) throw unauthorized();
    return r.rows[0] as {
      ownerId: string;
      deviceId: string;
      sessionId: string;
    };
  };
  app.get(
    "/v1/environment",
    { schema: { response: { 200: EnvironmentDTO, ...errors } } },
    async () => ({
      name: config.environmentName,
      host: url.host,
      pushMode: config.pushMode,
      modelDataDestination: config.modelDataDestination,
      capabilities,
    }),
  );
  app.get("/health/live", async () => ({ status: "alive" }));
  app.get(
    "/health/ready",
    {
      schema: {
        response: {
          200: Type.Object({
            status: Type.String(),
            capabilities: Type.Array(Type.String()),
          }),
          503: ErrorDTO,
        },
      },
    },
    async () => {
      await db.execute(sql`select 1`);
      return { status: "ready", capabilities };
    },
  );
  app.post(
    "/v1/admin/pairings",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        headers: MutationHeaders,
        body: Type.Object({}, { additionalProperties: false }),
        response: {
          200: Type.Object({
            code: Type.String(),
            expiresAt: Type.String({ format: "date-time" }),
          }),
          ...errors,
        },
      },
    },
    async (req) => {
      await rate("admin:" + hash(req.ip));
      admin(req.headers.authorization);
      return operate(
        "admin-pairing",
        req.headers["idempotency-key"],
        {},
        async (tx) => {
          const code = randomBytes(9).toString("base64url");
          const expiresAt = new Date(
            now().getTime() + (config.pairingTtlSeconds ?? 300) * 1000,
          );
          await tx.execute(
            sql`insert into pairing(code_hash,expires_at) values (${hash(code)},${expiresAt})`,
          );
          return { code, expiresAt: expiresAt.toISOString() };
        },
      );
    },
  );
  const issue = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ownerId: string,
    deviceId: string,
    sessionId: string = randomUUID(),
  ) => {
    const accessToken = randomBytes(32).toString("base64url"),
      refreshToken = randomBytes(32).toString("base64url");
    const accessExpiresAt = new Date(now().getTime() + 900000),
      refreshExpiresAt = new Date(now().getTime() + 30 * 86400000);
    await tx.execute(
      sql`INSERT INTO session(id,owner_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES (${sessionId},${ownerId},${deviceId},${hash(accessToken)},${hash(refreshToken)},${accessExpiresAt},${refreshExpiresAt}) ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,refresh_hash=excluded.refresh_hash,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at`,
    );
    return {
      ownerId,
      deviceId,
      sessionId,
      accessToken,
      refreshToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      capabilities,
      sync: { state: "not_available" as const },
    };
  };
  const operate = async (
    scope: string,
    idempotencyKey: string,
    body: unknown,
    work: (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => Promise<unknown>,
  ) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM owner FOR UPDATE`);
      const digest = hash(
        JSON.stringify(
          body,
          Object.keys(body as Record<string, unknown>).sort(),
        ),
      );
      const previous = await tx.execute(
        sql`SELECT body_hash,encrypted_result,expires_at FROM identity_operation WHERE scope=${scope} AND key=${idempotencyKey}`,
      );
      const row = previous.rows[0];
      if (row) {
        if (row.body_hash !== digest)
          throw new PublicError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "相同操作标识的内容不同。",
          );
        if (new Date(row.expires_at as string) <= now())
          throw new PublicError(
            410,
            "OPERATION_EXPIRED",
            "此操作已过期，请核对连接状态。",
          );
        const result = unseal(row.encrypted_result as string);
        const responseExpiresAt = result.accessExpiresAt ?? result.expiresAt;
        if (new Date(responseExpiresAt) <= now())
          throw new PublicError(
            410,
            "CREDENTIAL_RESPONSE_EXPIRED",
            "此操作凭据已过期，请重新连接。",
          );
        if (result.accessToken) {
          const active = await tx.execute(
            sql`SELECT s.id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.id=${result.sessionId} AND s.access_hash=${hash(result.accessToken)} AND s.revoked_at IS NULL AND d.revoked_at IS NULL`,
          );
          if (!active.rows[0]) throw unauthorized();
        }
        return result;
      }
      const result = await work(tx);
      await tx.execute(
        sql`INSERT INTO identity_operation(scope,key,body_hash,encrypted_result,expires_at) VALUES (${scope},${idempotencyKey},${digest},${seal(result)},${new Date(now().getTime() + 90 * 86400000)})`,
      );
      return result;
    });
  app.post(
    "/v1/pairings/claim",
    {
      schema: {
        headers: MutationHeaders,
        body: ClaimDTO,
        response: { 200: CredentialsDTO, ...errors },
      },
    },
    async (req) => {
      await rate("claim:" + hash(req.ip));
      return await operate(
        "claim",
        req.headers["idempotency-key"],
        req.body,
        async (tx) => {
          const result = await tx.execute(
            sql`UPDATE pairing SET consumed_at=${now()} WHERE code_hash=${hash(req.body.code)} AND consumed_at IS NULL AND expires_at>${now()} RETURNING code_hash`,
          );
          if (!result.rows[0])
            throw new PublicError(
              401,
              "PAIRING_REJECTED",
              "配对码无效或已失效，请生成新码。",
            );
          const active = await tx.execute(
            sql`SELECT id FROM device WHERE revoked_at IS NULL`,
          );
          if (active.rows[0])
            throw new PublicError(
              409,
              "PRIMARY_DEVICE_EXISTS",
              "已有主要设备，请先由管理员吊销旧设备。",
            );
          const ownerId = "00000000-0000-4000-8000-000000000001",
            deviceId = randomUUID();
          await tx.execute(
            sql`INSERT INTO device(id,owner_id,name) VALUES (${deviceId},${ownerId},${req.body.deviceName})`,
          );
          return issue(tx, ownerId, deviceId);
        },
      );
    },
  );
  app.get(
    "/v1/session",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: { 200: SessionDTO, ...errors },
      },
    },
    async (req) => session(req.headers.authorization),
  );
  app.post(
    "/v1/session/renew",
    {
      schema: {
        headers: MutationHeaders,
        body: RenewDTO,
        response: { 200: CredentialsDTO, ...errors },
      },
    },
    async (req) => {
      await rate("renew:" + hash(req.ip));
      return operate(
        "renew:" + hash(req.body.refreshToken),
        req.headers["idempotency-key"],
        req.body,
        async (tx) => {
          const r = await tx.execute(
            sql`SELECT s.id,s.owner_id,s.device_id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.refresh_hash=${hash(req.body.refreshToken)} AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.refresh_expires_at>${now()} FOR UPDATE OF s`,
          );
          const row = r.rows[0];
          if (!row) throw unauthorized();
          return issue(
            tx,
            row.owner_id as string,
            row.device_id as string,
            row.id as string,
          );
        },
      );
    },
  );
  app.delete(
    "/v1/session",
    {
      schema: {
        description:
          "Revoke this session and its paired primary device, freeing the pairing slot. Identical retries recover the same response.",
        headers: MutationHeaders,
        security: [{ bearerAuth: [] }],
        response: { 200: Type.Object({ revoked: Type.Boolean() }), ...errors },
      },
    },
    async (req) => {
      const identity = await session(req.headers.authorization, true);
      return operate(
        `${identity.ownerId}:${identity.deviceId}:revoke-session`,
        req.headers["idempotency-key"],
        { sessionId: identity.sessionId },
        async (tx) => {
          const r = await tx.execute(
            sql`UPDATE session SET revoked_at=${now()} WHERE id=${identity.sessionId} AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM device WHERE id=${identity.deviceId} AND revoked_at IS NULL) RETURNING id`,
          );
          if (!r.rows[0]) throw unauthorized();
          await tx.execute(
            sql`UPDATE device SET revoked_at=${now()} WHERE id=${identity.deviceId}`,
          );
          await tx.execute(
            sql`UPDATE session SET revoked_at=${now()} WHERE device_id=${identity.deviceId}`,
          );
          return { revoked: true };
        },
      );
    },
  );
  app.delete(
    "/v1/admin/devices/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        headers: MutationHeaders,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: Type.Object({ revoked: Type.Boolean() }), ...errors },
      },
    },
    async (req) => {
      await rate("admin:" + hash(req.ip));
      admin(req.headers.authorization);
      return operate(
        "admin-device-revoke",
        req.headers["idempotency-key"],
        { id: req.params.id },
        async (tx) => {
          await tx.execute(
            sql`UPDATE device SET revoked_at=${now()} WHERE id=${req.params.id}`,
          );
          await tx.execute(
            sql`UPDATE session SET revoked_at=${now()} WHERE device_id=${req.params.id}`,
          );
          return { revoked: true };
        },
      );
    },
  );
  await registerGmail(app, {
    pool,
    session,
    gmail: config.gmail,
    publicUrl: config.publicUrl,
    modelDataDestination: config.modelDataDestination,
    clock: config.clock,
  });
  return app;
}

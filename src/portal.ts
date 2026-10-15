import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { Type } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { PublicError } from "./app.js";
import type { ApnsIdentity, PushSender, PushResult } from "./apns.js";
import { portalHTML } from "./portal-page.js";

export async function registerPortal(
  instance: FastifyInstance,
  ctx: {
    pool: pg.Pool;
    admin: (authorization?: string) => void;
    rate: (bucket: string) => Promise<void>;
    now: () => Date;
    apns?: ApnsIdentity;
    send?: PushSender;
    environmentName: string;
    publicUrl: string;
  },
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const sessions = new Map<string, number>();
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  app.addHook("onClose", async () => {
    sessions.clear();
  });
  function sameOrigin(req: FastifyRequest) {
    if (
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.host}` &&
      req.headers.origin !== ctx.publicUrl
    )
      throw new PublicError(403, "ORIGIN_REJECTED", "请从 Portal 页面操作。");
  }
  function authorize(req: FastifyRequest) {
    sameOrigin(req);
    if (req.headers.authorization) return ctx.admin(req.headers.authorization);
    const token =
      req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("haiji_portal="))
        ?.slice(13) ?? "";
    if ((sessions.get(hash(token)) ?? 0) <= Date.now())
      throw new PublicError(401, "PORTAL_LOGIN_REQUIRED", "请先登录管理页面。");
  }
  app.get("/portal", { schema: { hide: true } }, async (_, reply) =>
    reply
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      .header("x-content-type-options", "nosniff")
      .type("text/html; charset=utf-8")
      .send(portalHTML),
  );
  // Assets are bundled strings so the compiled backend needs no separate static hosting.
  const { portalCSS, portalJS } = await import("./portal-page.js");
  app.get("/portal/style.css", { schema: { hide: true } }, async (_, r) =>
    r.type("text/css").send(portalCSS),
  );
  app.get("/portal/app.js", { schema: { hide: true } }, async (_, r) =>
    r.type("text/javascript").send(portalJS),
  );
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/v1/portal"))
      reply.header("cache-control", "no-store");
  });
  app.post(
    "/v1/portal/login",
    {
      schema: {
        hide: true,
        body: Type.Object(
          { secret: Type.String({ maxLength: 500 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      sameOrigin(req);
      await ctx.rate("portal-login:" + hash(req.ip));
      ctx.admin("Bearer " + req.body.secret);
      for (const [key, expiry] of sessions)
        if (expiry <= Date.now()) sessions.delete(key);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
      const token = randomBytes(32).toString("base64url");
      sessions.set(hash(token), Date.now() + 12 * 3600000);
      reply.header(
        "set-cookie",
        `haiji_portal=${token}; Path=/v1/portal; HttpOnly; SameSite=Strict; Max-Age=43200${req.protocol === "https" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname) ? "; Secure" : ""}`,
      );
      return { loggedIn: true };
    },
  );
  app.post(
    "/v1/portal/logout",
    { schema: { hide: true } },
    async (req, reply) => {
      authorize(req);
      const token =
        req.headers.cookie?.match(/(?:^|;\s*)haiji_portal=([^;]+)/)?.[1] ?? "";
      sessions.delete(hash(token));
      reply.header(
        "set-cookie",
        "haiji_portal=; Path=/v1/portal; HttpOnly; SameSite=Strict; Max-Age=0",
      );
      return { loggedIn: false };
    },
  );
  app.get("/v1/portal/status", { schema: { hide: true } }, async (req) => {
    authorize(req);
    await ctx.pool.query(
      "UPDATE push_test SET status='unknown',finished_at=$1 WHERE status='sending' AND created_at < $1::timestamptz-interval '30 seconds'",
      [ctx.now()],
    );
    const devices = (
      await ctx.pool.query(
        `SELECT d.id,d.name,d.revoked_at,p.registered_at,p.enabled,p.authorized,p.invalidated_at,
      (p.topic=$1 AND p.environment=$2) AS identity_matches
      FROM device d LEFT JOIN push_registration p ON p.owner_id=d.owner_id AND p.device_id=d.id ORDER BY d.revoked_at NULLS FIRST,d.id`,
        [ctx.apns?.topic ?? "", ctx.apns?.environment ?? ""],
      )
    ).rows;
    const tests = (
      await ctx.pool.query(
        "SELECT id,device_id,status,last_error,created_at,finished_at FROM push_test ORDER BY created_at DESC,id DESC LIMIT 30",
      )
    ).rows;
    const reminders = (
      await ctx.pool.query(
        `SELECT o.id,t.title,o.status,o.scheduled_at,o.attempt,o.last_error FROM remote_occurrence o JOIN reminder r ON r.owner_id=o.owner_id AND r.id=o.reminder_id JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id ORDER BY o.created_at DESC,o.id DESC LIMIT 30`,
      )
    ).rows;
    return {
      environmentName: ctx.environmentName,
      publicUrl: ctx.publicUrl,
      apns: {
        configured: !!ctx.apns && !!ctx.send,
        topic: ctx.apns?.topic ?? null,
        environment: ctx.apns?.environment ?? null,
      },
      devices,
      tests,
      reminders,
    };
  });
  app.post("/v1/portal/pairings", { schema: { hide: true } }, async (req) => {
    authorize(req);
    await ctx.rate("portal-pairing");
    if (
      (await ctx.pool.query("SELECT id FROM device WHERE revoked_at IS NULL"))
        .rowCount
    )
      throw new PublicError(
        409,
        "PRIMARY_DEVICE_EXISTS",
        "已有连接的设备。请先在 App 中断开旧设备。",
      );
    const code = randomBytes(9).toString("base64url"),
      expiresAt = new Date(ctx.now().getTime() + 300000);
    await ctx.pool.query(
      "INSERT INTO pairing(code_hash,expires_at) VALUES($1,$2)",
      [hash(code), expiresAt],
    );
    return { code, expiresAt };
  });
  app.post(
    "/v1/portal/push-tests",
    {
      schema: {
        hide: true,
        headers: Type.Object({
          "idempotency-key": Type.String({ format: "uuid" }),
        }),
        body: Type.Object(
          { deviceId: Type.String({ format: "uuid" }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      authorize(req);
      if (!ctx.apns || !ctx.send)
        throw new PublicError(
          409,
          "APNS_NOT_CONFIGURED",
          "服务器尚未配置 APNs。请先完成密钥配置。",
        );
      const c = await ctx.pool.connect();
      let target: { token: string; owner_id: string; registered_at: Date };
      const id = req.headers["idempotency-key"];
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM owner FOR UPDATE");
        const previous = (
          await c.query(
            "SELECT id,device_id,status,last_error,created_at,finished_at FROM push_test WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (previous) {
          if (previous.device_id !== req.body.deviceId)
            throw new PublicError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "相同测试标识对应了另一台设备。",
            );
          await c.query("COMMIT");
          return previous;
        }
        await ctx.rate("portal-push:" + req.body.deviceId);
        target = (
          await c.query(
            `SELECT p.token,p.owner_id,p.registered_at FROM push_registration p JOIN device d ON d.owner_id=p.owner_id AND d.id=p.device_id
        WHERE d.id=$1 AND d.revoked_at IS NULL AND p.enabled AND p.authorized AND p.invalidated_at IS NULL AND p.topic=$2 AND p.environment=$3 FOR SHARE OF p,d`,
            [req.body.deviceId, ctx.apns.topic, ctx.apns.environment],
          )
        ).rows[0];
        if (!target)
          throw new PublicError(
            409,
            "PUSH_DEVICE_NOT_READY",
            "请在此 iPhone 的“我的 → 远程通知”中启用，并允许系统通知。",
          );
        await c.query(
          "INSERT INTO push_test(id,device_id,status,created_at) VALUES($1,$2,'sending',$3)",
          [id, req.body.deviceId, ctx.now()],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      let result: PushResult;
      try {
        result = await ctx.send({
          id,
          token: target.token,
          expiration: new Date(ctx.now().getTime() + 60000),
          payload: {
            aps: {
              alert: {
                title: "Haiji 测试通知",
                body: "远程推送已到达。这是一条测试通知。",
              },
              sound: "default",
            },
            ownerId: target.owner_id,
            deviceId: req.body.deviceId,
          },
        });
      } catch {
        result = { status: "unknown" };
      }
      const status = result.status === "rejected" ? "failed" : result.status;
      const error = result.status === "rejected" ? result.reason : null;
      if (result.status === "rejected" && result.invalidToken)
        await ctx.pool.query(
          "UPDATE push_registration SET invalidated_at=$1 WHERE device_id=$2 AND token=$3 AND registered_at=$4",
          [ctx.now(), req.body.deviceId, target.token, target.registered_at],
        );
      return (
        await ctx.pool.query(
          "UPDATE push_test SET status=$2,last_error=$3,finished_at=$4 WHERE id=$1 RETURNING id,device_id,status,last_error,created_at,finished_at",
          [id, status, error, ctx.now()],
        )
      ).rows[0];
    },
  );
}

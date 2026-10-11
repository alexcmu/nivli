import { describe, test, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
const rootUrl =
  process.env.DATABASE_URL ??
  "postgres://nivli:nivli@127.0.0.1:55432/nivli_test";
const fixtureName = "nivli_test_" + randomUUID().replaceAll("-", "");
const fixtureUrl = new URL(rootUrl);
fixtureUrl.pathname = "/" + fixtureName;
const databaseUrl = fixtureUrl.toString();
const maintenance = new pg.Pool({ connectionString: rootUrl });
let app: Awaited<ReturnType<typeof createApp>>;
let base = "";
let clock = Date.now();
let logs = "";
const admin = "a".repeat(48);
const call = async (
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
  key = randomUUID(),
) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "idempotency-key": key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};
describe("personal environment pairing over HTTP with PostgreSQL", () => {
  beforeAll(async () => {
    await maintenance.query(`CREATE DATABASE ${fixtureName}`);
    await migrate(databaseUrl);
    app = await createApp({
      databaseUrl,
      adminSecret: admin,
      publicUrl: "https://nivli.example",
      environmentName: "My Nivli",
      pushMode: "disabled",
      modelDataDestination: "No model configured",
      clock: () => new Date(clock),
      logger: true,
      logStream: {
        write: (message) => {
          logs += message;
        },
      },
    });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });
  afterAll(async () => {
    await app?.close();
    await maintenance.query(`DROP DATABASE ${fixtureName} WITH (FORCE)`);
    await maintenance.end();
  });
  test("public environment excludes private data and business access requires device credentials", async () => {
    const env = await call("/v1/environment");
    expect(env.status).toBe(200);
    expect(env.body).toMatchObject({
      name: "My Nivli",
      host: "nivli.example",
      pushMode: "disabled",
    });
    const session = await call("/v1/session");
    expect(session.status).toBe(401);
    expect(session.body).toMatchObject({
      code: "UNAUTHENTICATED",
      retryable: false,
      requestId: expect.any(String),
      message: expect.any(String),
    });
    expect((await call("/v1/admin/pairings", "POST", {}, "wrong")).status).toBe(
      401,
    );
  });
  test("one code is consumed once, retries recover credentials, rotation invalidates old tokens and revocation rejects reads", async () => {
    clock += 60000;
    const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    const key = randomUUID(),
      body = { code, deviceName: "iPhone" };
    const paired = await call(
      "/v1/pairings/claim",
      "POST",
      body,
      undefined,
      key,
    );
    expect(paired.status).toBe(200);
    expect(
      (await call("/v1/pairings/claim", "POST", body, undefined, key)).body,
    ).toEqual(paired.body);
    expect((await call("/v1/pairings/claim", "POST", body)).status).toBe(401);
    expect(
      (await call("/v1/session", "GET", undefined, paired.body.accessToken))
        .body,
    ).toMatchObject({
      ownerId: paired.body.ownerId,
      deviceId: paired.body.deviceId,
      sessionId: paired.body.sessionId,
    });
    const renewed = await call("/v1/session/renew", "POST", {
      refreshToken: paired.body.refreshToken,
    });
    expect(renewed.status).toBe(200);
    expect(
      (await call("/v1/session", "GET", undefined, paired.body.accessToken))
        .status,
    ).toBe(401);
    expect(
      (
        await call("/v1/session/renew", "POST", {
          refreshToken: paired.body.refreshToken,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "/v1/admin/devices/" + paired.body.deviceId,
          "DELETE",
          undefined,
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("/v1/session", "GET", undefined, renewed.body.accessToken))
        .status,
    ).toBe(401);
    expect(
      (await call("/v1/pairings/claim", "POST", body, undefined, key)).status,
    ).toBe(401);
  });

  test("concurrent code consumption has exactly one winner and a second primary device is explicitly rejected", async () => {
    clock += 60000;
    const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        call("/v1/pairings/claim", "POST", { code, deviceName: "iPhone" }),
      ),
    );
    expect(claims.map((c) => c.status).sort()).toEqual([
      200, 401, 401, 401, 401,
    ]);
    const winner = claims.find((c) => c.status === 200)!;
    const second = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    expect(
      (
        await call("/v1/pairings/claim", "POST", {
          code: second,
          deviceName: "replacement",
        })
      ).body.code,
    ).toBe("PRIMARY_DEVICE_EXISTS");
    await call(
      "/v1/admin/devices/" + winner.body.deviceId,
      "DELETE",
      undefined,
      admin,
    );
    const replacement = await call("/v1/pairings/claim", "POST", {
      code: second,
      deviceName: "replacement",
    });
    expect(replacement.status).toBe(200);
    await call(
      "/v1/admin/devices/" + replacement.body.deviceId,
      "DELETE",
      undefined,
      admin,
    );
  });

  test("expired codes and credentials fail, refresh remains available after access expiry, and rate limits persist across API restart", async () => {
    clock += 60000;
    const expired = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    clock += 301000;
    expect(
      (
        await call("/v1/pairings/claim", "POST", {
          code: expired,
          deviceName: "phone",
        })
      ).body.code,
    ).toBe("PAIRING_REJECTED");
    const valid = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    const paired = await call("/v1/pairings/claim", "POST", {
      code: valid,
      deviceName: "phone",
    });
    clock += 901000;
    expect(
      (await call("/v1/session", "GET", undefined, paired.body.accessToken))
        .status,
    ).toBe(401);
    const renewed = await call("/v1/session/renew", "POST", {
      refreshToken: paired.body.refreshToken,
    });
    expect(renewed.status).toBe(200);
    clock += 30 * 86400000 + 1000;
    expect(
      (
        await call("/v1/session/renew", "POST", {
          refreshToken: renewed.body.refreshToken,
        })
      ).status,
    ).toBe(401);
    await call(
      "/v1/admin/devices/" + paired.body.deviceId,
      "DELETE",
      undefined,
      admin,
    );
    for (let n = 0; n < 10; n++)
      expect(
        (
          await call("/v1/pairings/claim", "POST", {
            code: "invalid",
            deviceName: "phone",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await call("/v1/pairings/claim", "POST", {
          code: "invalid",
          deviceName: "phone",
        })
      ).body.code,
    ).toBe("RATE_LIMITED");
    await app.close();
    app = await createApp({
      databaseUrl,
      adminSecret: admin,
      publicUrl: "https://nivli.example",
      environmentName: "My Nivli",
      pushMode: "disabled",
      modelDataDestination: "No model configured",
      clock: () => new Date(clock),
      logger: true,
      logStream: {
        write: (message) => {
          logs += message;
        },
      },
    });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
    expect(
      (
        await call("/v1/pairings/claim", "POST", {
          code: "invalid",
          deviceName: "phone",
        })
      ).status,
    ).toBe(429);
    clock += 60000;
    expect(
      (
        await call("/v1/pairings/claim", "POST", {
          code: "invalid",
          deviceName: "phone",
        })
      ).status,
    ).toBe(401);
  });
  test("administrator code creation retries preserve a single one-time code", async () => {
    clock += 60000;
    const key = randomUUID();
    const created = await call("/v1/admin/pairings", "POST", {}, admin, key);
    const retry = await call("/v1/admin/pairings", "POST", {}, admin, key);
    expect(retry.body).toEqual(created.body);
  });
  test("invalid input and authorization errors do not expose credentials or request bodies in logs", async () => {
    clock += 60000;
    const privateText = "PRIVATE_BODY_SENTINEL";
    const result = await call("/v1/pairings/claim", "POST", {
      code: privateText,
      deviceName: "phone",
      unexpected: privateText,
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      code: "INVALID_INPUT",
      retryable: false,
    });
    const unauthorized = await call(
      "/v1/session",
      "GET",
      undefined,
      privateText,
    );
    expect(unauthorized.status).toBe(401);
    expect(logs).not.toContain(privateText);
    expect(logs).not.toContain(admin);
  });
  test("revocation retries recover the same response and reused mutation keys reject different contents", async () => {
    clock += 60000;
    const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    const claimKey = randomUUID(),
      body = { code, deviceName: "phone" };
    const paired = await call(
      "/v1/pairings/claim",
      "POST",
      body,
      undefined,
      claimKey,
    );
    expect(
      (
        await call(
          "/v1/pairings/claim",
          "POST",
          { ...body, deviceName: "different" },
          undefined,
          claimKey,
        )
      ).status,
    ).toBe(409);
    const revokeKey = randomUUID();
    const revoked = await call(
      "/v1/session",
      "DELETE",
      undefined,
      paired.body.accessToken,
      revokeKey,
    );
    expect(revoked.status).toBe(200);
    expect(
      await call(
        "/v1/session",
        "DELETE",
        undefined,
        paired.body.accessToken,
        revokeKey,
      ),
    ).toEqual(revoked);
    expect(
      (await call("/v1/session", "DELETE", undefined, paired.body.accessToken))
        .status,
    ).toBe(401);
    const deviceKey = randomUUID();
    const deviceRevoked = await call(
      "/v1/admin/devices/" + paired.body.deviceId,
      "DELETE",
      undefined,
      admin,
      deviceKey,
    );
    expect(
      await call(
        "/v1/admin/devices/" + paired.body.deviceId,
        "DELETE",
        undefined,
        admin,
        deviceKey,
      ),
    ).toEqual(deviceRevoked);
    expect(
      (
        await call(
          "/v1/admin/devices/" + randomUUID(),
          "DELETE",
          undefined,
          admin,
          deviceKey,
        )
      ).status,
    ).toBe(409);
  });
  test("retry bodies with different JSON key order recover the original credentials", async () => {
    clock += 60000;
    const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body
      .code;
    const key = randomUUID();
    const original = await call(
      "/v1/pairings/claim",
      "POST",
      { code, deviceName: "phone" },
      undefined,
      key,
    );
    const replay = await call(
      "/v1/pairings/claim",
      "POST",
      { deviceName: "phone", code },
      undefined,
      key,
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(original.body);
    await call(
      "/v1/admin/devices/" + original.body.deviceId,
      "DELETE",
      undefined,
      admin,
    );
  });
});

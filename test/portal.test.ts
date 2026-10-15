import { beforeAll, afterAll, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
import { dropFixtureDatabase } from "./database-cleanup.js";
import type { PushRequest, PushResult } from "../src/apns.js";
const root =
  process.env.DATABASE_URL ??
  "postgres://haiji:haiji@127.0.0.1:55432/haiji_test";
const name = "portal_" + randomUUID().replaceAll("-", "");
const url = new URL(root);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  admin = "portal-secret-".repeat(4),
  maintenance = new pg.Pool({ connectionString: root }),
  db = new pg.Pool({ connectionString: databaseUrl });
let app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  deviceId = "",
  token = "";
const sent: PushRequest[] = [];
let answer: PushResult = { status: "accepted" };
async function request(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    url: path,
    method,
    headers: { cookie, ...headers },
    ...(payload ? { payload } : {}),
  });
}
async function push(id = randomUUID(), device = deviceId) {
  return request(
    "/v1/portal/push-tests",
    "POST",
    { deviceId: device },
    { "idempotency-key": id },
  );
}
beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  await migrate(databaseUrl);
  app = await createApp({
    databaseUrl,
    adminSecret: admin,
    publicUrl: "https://haiji.example",
    environmentName: "Portal test",
    pushMode: "self_signed",
    modelDataDestination: "none",
    apns: { topic: "app.haiji.Haiji", environment: "development" },
    sendPush: async (r) => {
      sent.push(r);
      return answer;
    },
  });
});
afterAll(async () => {
  await app?.close();
  await db.end();
  await dropFixtureDatabase(maintenance, name);
  await maintenance.end();
});
test("portal login protects status and pairing; cookie is HttpOnly and foreign origins rejected", async () => {
  const page = await request("/portal");
  expect(page.statusCode).toBe(200);
  expect(page.headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect((await request("/v1/portal/status")).statusCode).toBe(401);
  expect(
    (
      await request(
        "/v1/portal/login",
        "POST",
        { secret: admin },
        { origin: "https://evil.example" },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await request("/v1/portal/login", "POST", { secret: "wrong" })).statusCode,
  ).toBe(401);
  const secureLogin = await app.inject({
    url: "/v1/portal/login",
    method: "POST",
    headers: { host: "haiji.example", origin: "https://haiji.example" },
    payload: { secret: admin },
  });
  expect(secureLogin.headers["set-cookie"]).toContain("; Secure");
  const login = await request("/v1/portal/login", "POST", { secret: admin });
  expect(login.statusCode).toBe(200);
  expect(login.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  expect((await request("/v1/portal/status")).statusCode).toBe(200);
  expect((await push()).statusCode).toBe(422);
  const pairedCode = (await request("/v1/portal/pairings", "POST", {})).json()
    .code;
  const credentials = (
    await request(
      "/v1/pairings/claim",
      "POST",
      { code: pairedCode, deviceName: "Test iPhone" },
      { "idempotency-key": randomUUID() },
    )
  ).json();
  deviceId = credentials.deviceId;
  token = credentials.accessToken;
  expect((await request("/v1/portal/pairings", "POST", {})).statusCode).toBe(
    409,
  );
  expect((await push()).statusCode).toBe(409);
  const registration = await request(
    `/v1/devices/${deviceId}/push`,
    "PUT",
    {
      token: "ab".repeat(32),
      topic: "app.haiji.Haiji",
      environment: "development",
      enabled: true,
      authorized: true,
    },
    { authorization: "Bearer " + token, "idempotency-key": randomUUID() },
  );
  expect(registration.statusCode).toBe(200);
});
test("concurrent double-click sends once; test notification has no task and secrets never appear in status", async () => {
  const key = randomUUID();
  const results = await Promise.all([push(key), push(key)]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.payload).not.toHaveProperty("taskId");
  expect(sent[0]?.payload.aps).toHaveProperty("alert.title", "Haiji 测试通知");
  expect((await push(key, randomUUID())).statusCode).toBe(409);
  const status = (await request("/v1/portal/status")).json();
  expect(status.tests[0].status).toBe("accepted");
  expect(status.devices[0].name).toBe("Test iPhone");
  expect(JSON.stringify(status)).not.toContain("ab".repeat(32));
  expect(JSON.stringify(status)).not.toContain(admin);
  expect((await db.query("SELECT count(*) FROM task")).rows[0].count).toBe("0");
});
test("unknown transport is not retried; stale send leases become unknown; invalid token disables later tests", async () => {
  answer = { status: "unknown" };
  const key = randomUUID();
  expect((await push(key)).json().status).toBe("unknown");
  await push(key);
  expect(sent).toHaveLength(2);
  await db.query(
    "INSERT INTO push_test(id,device_id,status,created_at) VALUES($1,$2,'sending',clock_timestamp()-interval '1 minute')",
    [randomUUID(), deviceId],
  );
  expect(
    (await request("/v1/portal/status"))
      .json()
      .tests.some((t: { status: string }) => t.status === "sending"),
  ).toBe(false);
  answer = {
    status: "rejected",
    reason: "Unregistered",
    retryable: false,
    invalidToken: true,
  };
  expect((await push()).json().last_error).toBe("Unregistered");
  expect((await push()).statusCode).toBe(409);
});
test("upgrade retires legacy tables, preserves quiet confirmation and never replays elapsed local reminders", async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const create = async (instant: string) => {
    const r = await request(
      "/v1/tasks",
      "POST",
      {
        taskId: randomUUID(),
        commandId: randomUUID(),
        title: "upgrade",
        reminder: { instant, timeZone: "UTC" },
      },
      { authorization: "Bearer " + token, "idempotency-key": randomUUID() },
    );
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const quiet = await create(future),
    elapsed = await create(future);
  await db.query(
    "DELETE FROM remote_occurrence WHERE reminder_id=ANY($1::uuid[])",
    [[quiet.reminder.id, elapsed.reminder.id]],
  );
  await db.query(
    "ALTER TABLE reminder DROP CONSTRAINT reminder_scheduling_status_check; CREATE TABLE local_occurrence(id uuid); CREATE TABLE notification_plan_command(id uuid)",
  );
  await db.query(
    "UPDATE reminder SET scheduling_status='needs_confirmation' WHERE id=$1",
    [quiet.reminder.id],
  );
  await db.query(
    "UPDATE reminder SET scheduling_status='local_installed',instant=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [elapsed.reminder.id],
  );
  await migrate(databaseUrl);
  const records = (
    await db.query("SELECT * FROM remote_occurrence ORDER BY id")
  ).rows;
  expect(
    records.find((r) => r.reminder_id === quiet.reminder.id)
      .quiet_hours_confirmed,
  ).toBe(false);
  expect(
    records.find((r) => r.reminder_id === elapsed.reminder.id).status,
  ).toBe("expired");
  expect(
    (await db.query("SELECT to_regclass('local_occurrence') AS legacy")).rows[0]
      .legacy,
  ).toBeNull();
  await migrate(databaseUrl);
  expect(
    (await db.query("SELECT * FROM remote_occurrence ORDER BY id")).rows,
  ).toEqual(records);
});
test("revocation prevents pushes and logout invalidates session", async () => {
  await request(`/v1/admin/devices/${deviceId}`, "DELETE", undefined, {
    authorization: "Bearer " + admin,
    "idempotency-key": randomUUID(),
  });
  expect((await push()).statusCode).toBe(409);
  expect((await request("/v1/portal/logout", "POST", {})).statusCode).toBe(200);
  expect((await request("/v1/portal/status")).statusCode).toBe(401);
});

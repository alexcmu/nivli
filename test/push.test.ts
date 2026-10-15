import { beforeAll, afterAll, test, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
import { startDeliveryWorker } from "../src/delivery-worker.js";
import type { PushRequest, PushResult } from "../src/apns.js";
import { dropFixtureDatabase } from "./database-cleanup.js";
const root =
  process.env.DATABASE_URL ??
  "postgres://haiji:haiji@127.0.0.1:55432/haiji_test";
const name = "push_" + randomUUID().replaceAll("-", ""),
  url = new URL(root);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  admin = "p".repeat(48),
  maintenance = new pg.Pool({ connectionString: root }),
  db = new pg.Pool({ connectionString: databaseUrl });
const apns = { topic: "app.haiji.Haiji", environment: "development" as const };
let clock = new Date(Date.now() + 86400000),
  token = "",
  deviceId = "",
  refreshToken = "",
  app: Awaited<ReturnType<typeof createApp>>,
  worker: Awaited<ReturnType<typeof startDeliveryWorker>>;
const sent: PushRequest[] = [];
let answer: PushResult = { status: "accepted" };
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  bearer = token,
  key = randomUUID(),
) {
  const r = await app.inject({
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    url: path,
    headers: { authorization: "Bearer " + bearer, "idempotency-key": key },
    ...(body ? { payload: body } : {}),
  });
  return { status: r.statusCode, body: r.json() };
}
const registration = {
  ...apns,
  token: "ab".repeat(32),
  authorized: true,
  enabled: true,
};
async function register(body = registration) {
  return call(`/v1/devices/${deviceId}/push`, "PUT", body);
}
async function draft(extra: Record<string, unknown> = {}) {
  const r = await call("/v1/tasks", "POST", {
    taskId: randomUUID(),
    commandId: randomUUID(),
    title: "PRIVATE TITLE",
    background: "PRIVATE BODY",
    remoteDeviceId: deviceId,
    quietHoursConfirmed: true,
    reminder: {
      instant: new Date(clock.getTime() + 1000).toISOString(),
      timeZone: "UTC",
    },
    ...extra,
  });
  expect(r.status).toBe(200);
  return r.body;
}
async function current(id: string) {
  return (await call("/v1/tasks/" + id)).body;
}
async function awaitState(id: string, state: string) {
  for (let n = 0; n < 100; n++) {
    const t = await current(id);
    if (t.reminder?.remoteOccurrence?.status === state) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    "State did not become " + state + ": " + JSON.stringify(await current(id)),
  );
}
async function due() {
  clock = new Date(clock.getTime() + 1100);
  await worker.scan();
  await db.query(
    "UPDATE pgboss.job SET start_after=clock_timestamp() WHERE name='remote-delivery'",
  );
}
beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  await migrate(databaseUrl);
  app = await createApp({
    databaseUrl,
    adminSecret: admin,
    publicUrl: "https://haiji.example",
    environmentName: "push",
    pushMode: "self_signed",
    modelDataDestination: "none",
    apns,
    clock: () => clock,
  });
  const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body.code;
  const paired = (
    await call("/v1/pairings/claim", "POST", { code, deviceName: "push test" })
  ).body;
  token = paired.accessToken;
  refreshToken = paired.refreshToken;
  deviceId = paired.deviceId;
  worker = await startDeliveryWorker({
    databaseUrl,
    apns,
    send: async (request) => {
      sent.push(request);
      return answer;
    },
    clock: () => clock,
    scanIntervalMs: 100,
  });
});
afterAll(async () => {
  await worker?.stop();
  await app?.close();
  await db.end();
  await dropFixtureDatabase(maintenance, name);
  await maintenance.end();
});
test("register only current authenticated device and matching configured identity; never expose token", async () => {
  expect((await register()).status).toBe(200);
  expect(
    (await register({ ...registration, topic: "foreign.app" })).status,
  ).toBe(409);
  expect(
    (await call(`/v1/devices/${randomUUID()}/push`, "PUT", registration))
      .status,
  ).toBe(404);
  expect(
    (await call(`/v1/devices/${deviceId}/push`, "PUT", registration, "invalid"))
      .status,
  ).toBe(401);
  const status = await call(`/v1/devices/${deviceId}/push`);
  expect(status.body).toMatchObject({
    configured: true,
    registered: true,
    enabled: true,
    invalidated: false,
  });
  expect(JSON.stringify(status.body)).not.toContain(registration.token);
  expect(
    (
      await call("/v1/tasks", "POST", {
        taskId: randomUUID(),
        commandId: randomUUID(),
        title: "x",
        localDeviceId: deviceId,
        remoteDeviceId: deviceId,
        reminder: {
          instant: new Date(clock.getTime() + 60000).toISOString(),
          timeZone: "UTC",
        },
      })
    ).status,
  ).toBe(422);
});
test("atomic durable remote intent, no local plan, generic accepted payload and duplicate queue claims", async () => {
  const task = await draft();
  expect(task.reminder.remoteOccurrence.status).toBe("planned");
  expect(task.reminder.occurrence).toBeUndefined();
  expect(
    (await call(`/v1/devices/${deviceId}/notification-plans`)).status,
  ).toBe(404);
  const count = sent.length;
  await due();
  const accepted = await awaitState(task.id, "accepted");
  expect(accepted.status).toBe("active");
  expect(sent.length).toBe(count + 1);
  expect(JSON.stringify(sent.at(-1)?.payload)).not.toMatch(/PRIVATE/);
  expect(sent.at(-1)?.payload.aps).toMatchObject({
    alert: { title: "Haiji 提醒" },
    category: "HAIJI_REMOTE_TASK",
  });
  await worker.scan();
  await new Promise((r) => setTimeout(r, 600));
  expect(sent.length).toBe(count + 1);
});
test("transport unknown and crashed sending are preserved through scan and restart", async () => {
  answer = { status: "unknown" };
  const task = await draft();
  const count = sent.length;
  await due();
  await awaitState(task.id, "unknown");
  const crashed = await draft();
  await db.query(
    "UPDATE remote_occurrence SET status='sending',lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [crashed.reminder.remoteOccurrence.id],
  );
  await worker.stop();
  worker = await startDeliveryWorker({
    databaseUrl,
    apns,
    send: async (request) => {
      sent.push(request);
      return answer;
    },
    clock: () => clock,
    scanIntervalMs: 100,
  });
  await awaitState(crashed.id, "unknown");
  await new Promise((r) => setTimeout(r, 700));
  expect(sent.length).toBe(count + 1);
  answer = { status: "accepted" };
});
test("explicit provider rejection retries at 5/30/120 seconds only and stops after fourth request", async () => {
  answer = {
    status: "rejected",
    reason: "ServiceUnavailable",
    retryable: true,
    invalidToken: false,
  };
  const task = await draft();
  const count = sent.length;
  await due();
  for (const [attempt, wait] of [
    [1, 5000],
    [2, 30000],
    [3, 120000],
  ]) {
    for (let n = 0; n < 100; n++) {
      const t = await current(task.id);
      if (
        t.reminder.remoteOccurrence.attempt === attempt &&
        t.reminder.remoteOccurrence.status === "planned"
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await current(task.id)).reminder.remoteOccurrence.attempt).toBe(
      attempt,
    );
    clock = new Date(clock.getTime() + wait!);
    await worker.scan();
    await db.query(
      "UPDATE pgboss.job SET start_after=clock_timestamp() WHERE name='remote-delivery'",
    );
  }
  const failed = await awaitState(task.id, "failed");
  expect(failed.reminder.remoteOccurrence.attempt).toBe(4);
  expect(sent.length).toBe(count + 4);
  answer = { status: "accepted" };
});
test("invalid token disables remote sending until re-registration", async () => {
  answer = {
    status: "rejected",
    reason: "Unregistered",
    retryable: false,
    invalidToken: true,
  };
  const task = await draft();
  await due();
  await awaitState(task.id, "failed");
  expect((await call(`/v1/devices/${deviceId}/push`)).body.invalidated).toBe(
    true,
  );
  expect(
    (
      await call("/v1/tasks", "POST", {
        taskId: randomUUID(),
        commandId: randomUUID(),
        title: "blocked",
        remoteDeviceId: deviceId,
        reminder: {
          instant: new Date(clock.getTime() + 60000).toISOString(),
          timeZone: "UTC",
        },
      })
    ).status,
  ).toBe(409);
  await register();
  answer = { status: "accepted" };
});
test("completion before claim cancels remote authority; changing a remote reminder never creates local intent", async () => {
  const task = await draft();
  const count = sent.length;
  const command = (
    operation: string,
    expectedRevision: number,
    extra = {},
  ) => ({
    operation,
    expectedRevision,
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    ...extra,
  });
  const updated = await call(
    `/v1/tasks/${task.id}/commands`,
    "POST",
    command("snooze", 1, {
      reminder: {
        instant: new Date(clock.getTime() + 2000).toISOString(),
        timeZone: "UTC",
      },
      quietHoursConfirmed: true,
    }),
  );
  expect(updated.status).toBe(200);
  expect(updated.body.reminder.remoteOccurrence.reminderRevision).toBe(2);
  expect(updated.body.reminder.occurrence).toBeUndefined();
  expect(
    (
      await call(
        `/v1/tasks/${task.id}/commands`,
        "POST",
        command("complete", 2),
      )
    ).status,
  ).toBe(200);
  clock = new Date(clock.getTime() + 3000);
  await worker.scan();
  await new Promise((r) => setTimeout(r, 700));
  expect(sent.length).toBe(count);
});
test("quiet hours require explicit confirmation and disabled/denied preference prevents sends", async () => {
  const quiet = new Date(clock.getTime() + 1000);
  quiet.setUTCHours(23, 0, 0, 0);
  if (quiet <= clock) quiet.setUTCDate(quiet.getUTCDate() + 1);
  const task = await draft({
    quietHoursConfirmed: false,
    reminder: { instant: quiet.toISOString(), timeZone: "UTC" },
  });
  expect(task.reminder.schedulingStatus).toBe("needs_confirmation");
  expect(
    (
      await call(`/v1/tasks/${task.id}/remote-confirmation`, "POST", {
        occurrenceId: task.reminder.remoteOccurrence.id,
        reminderRevision: 2,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(`/v1/tasks/${task.id}/remote-confirmation`, "POST", {
        occurrenceId: task.reminder.remoteOccurrence.id,
        reminderRevision: 1,
      })
    ).body.reminder.remoteOccurrence.quietHoursConfirmed,
  ).toBe(true);
  // Cancel future quiet test so it cannot fire during later clock advances.
  await call(`/v1/tasks/${task.id}/commands`, "POST", {
    operation: "cancel",
    expectedRevision: 1,
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
  });
  const blocked = await draft(),
    count = sent.length;
  await register({ ...registration, authorized: false });
  await due();
  await new Promise((r) => setTimeout(r, 650));
  expect(sent.length).toBe(count);
  expect((await current(blocked.id)).reminder.remoteOccurrence.status).toBe(
    "planned",
  );
  await register();
  await due();
  await awaitState(blocked.id, "accepted");
});
test("a replayed registration cannot re-enable push after disable and changed body conflicts", async () => {
  const key = randomUUID();
  expect(
    (
      await call(
        `/v1/devices/${deviceId}/push`,
        "PUT",
        registration,
        token,
        key,
      )
    ).status,
  ).toBe(200);
  expect(
    (await call(`/v1/devices/${deviceId}/push`, "DELETE")).body.enabled,
  ).toBe(false);
  expect(
    (
      await call(
        `/v1/devices/${deviceId}/push`,
        "PUT",
        registration,
        token,
        key,
      )
    ).body.enabled,
  ).toBe(false);
  expect(
    (
      await call(
        `/v1/devices/${deviceId}/push`,
        "PUT",
        { ...registration, token: "cd".repeat(32) },
        token,
        key,
      )
    ).status,
  ).toBe(409);
  await register();
});
test("commit failure rolls back remote outbox and retry creates exactly one; migration preserves pending intent", async () => {
  const input = {
    taskId: randomUUID(),
    commandId: randomUUID(),
    title: "atomic",
    remoteDeviceId: deviceId,
    quietHoursConfirmed: true,
    reminder: {
      instant: new Date(clock.getTime() + 300000).toISOString(),
      timeZone: "UTC",
    },
  };
  await db.query(
    "CREATE FUNCTION reject_push_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test commit fault'; END $$; CREATE TRIGGER reject_push BEFORE INSERT ON task_command FOR EACH ROW EXECUTE FUNCTION reject_push_commit()",
  );
  try {
    expect((await call("/v1/tasks", "POST", input)).status).toBe(503);
    expect((await call("/v1/tasks/" + input.taskId)).status).toBe(404);
  } finally {
    await db.query(
      "DROP TRIGGER reject_push ON task_command; DROP FUNCTION reject_push_commit()",
    );
  }
  const created = await call("/v1/tasks", "POST", input);
  expect(created.status).toBe(200);
  expect((await call("/v1/tasks", "POST", input)).body).toEqual(created.body);
  await worker.stop();
  await migrate(databaseUrl);
  worker = await startDeliveryWorker({
    databaseUrl,
    apns,
    send: async (request) => {
      sent.push(request);
      return answer;
    },
    clock: () => clock,
    scanIntervalMs: 100,
  });
  expect((await current(input.taskId)).reminder.remoteOccurrence.id).toBe(
    created.body.reminder.remoteOccurrence.id,
  );
  await call(`/v1/tasks/${input.taskId}/commands`, "POST", {
    operation: "cancel",
    expectedRevision: 1,
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
  });
});
test("two workers cannot claim the same occurrence; notification actions require current remote revision", async () => {
  const second = await startDeliveryWorker({
    databaseUrl,
    apns,
    send: async (request) => {
      sent.push(request);
      return answer;
    },
    clock: () => clock,
    scanIntervalMs: 100,
  });
  try {
    const task = await draft(),
      count = sent.length;
    await due();
    await second.scan();
    await awaitState(task.id, "accepted");
    expect(sent.length).toBe(count + 1);
    const remote = task.reminder.remoteOccurrence;
    const path = `/v1/tasks/${task.id}/commands`;
    const act = (routingVersion: number) => ({
      commandId: randomUUID(),
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      operation: "complete",
      occurrence: {
        id: remote.id,
        reminderRevision: 1,
        routingVersion,
        requestId: "haiji.remote." + remote.id + ".1",
      },
    });
    expect((await call(path, "POST", act(2))).status).toBe(409);
    expect((await call(path, "POST", act(1))).body.status).toBe("completed");
  } finally {
    await second.stop();
  }
});
test("deadline truncates only later catchup; expired reminders remain active without sending", async () => {
  const instant = new Date(clock.getTime() + 1000).toISOString(),
    end = new Date(clock.getTime() + 5000).toISOString();
  const task = await draft({
    reminder: { instant, timeZone: "UTC" },
    deadline: { kind: "instant", instant: end, timeZone: "UTC" },
  });
  expect(task.reminder.remoteOccurrence.expiresAt).toBe(end);
  const later = await draft({
    deadline: {
      kind: "instant",
      instant: new Date(clock.getTime() - 1000).toISOString(),
      timeZone: "UTC",
    },
  });
  expect(
    Date.parse(later.reminder.remoteOccurrence.expiresAt) -
      Date.parse(later.reminder.instant),
  ).toBe(900000);
  const count = sent.length;
  clock = new Date(clock.getTime() + 901100);
  token = (await call("/v1/session/renew", "POST", { refreshToken })).body
    .accessToken;
  await worker.scan();
  expect((await awaitState(task.id, "expired")).status).toBe("active");
  await awaitState(later.id, "expired");
  expect(sent.length).toBe(count);
});

test("revoking a device before claim prevents remote sends", async () => {
  const task = await draft(),
    count = sent.length;
  expect(
    (await call(`/v1/admin/devices/${deviceId}`, "DELETE", undefined, admin))
      .status,
  ).toBe(200);
  await due();
  await new Promise((r) => setTimeout(r, 700));
  expect(sent.length).toBe(count);
  expect(
    (
      await db.query("SELECT status FROM remote_occurrence WHERE id=$1", [
        task.reminder.remoteOccurrence.id,
      ])
    ).rows[0].status,
  ).toBe("cancelled");
  expect((await call(`/v1/devices/${deviceId}/push`)).status).toBe(401);
});

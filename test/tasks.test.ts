import { beforeAll, afterAll, test, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
const rootUrl =
  process.env.DATABASE_URL ??
  "postgres://nivli:nivli@127.0.0.1:55432/nivli_test";
const name = "tasks_" + randomUUID().replaceAll("-", "");
const url = new URL(rootUrl);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  maintenance = new pg.Pool({ connectionString: rootUrl });
const admin = "t".repeat(48);
const config = {
  databaseUrl,
  adminSecret: admin,
  publicUrl: "https://nivli.example",
  environmentName: "Tasks",
  pushMode: "disabled" as const,
  modelDataDestination: "None",
  clock: () => new Date("2026-10-11T12:00:00Z"),
};
let app: Awaited<ReturnType<typeof createApp>>,
  base = "",
  token = "",
  deviceId = "";
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  key = randomUUID(),
  authorization = token,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: "Bearer " + authorization,
      "idempotency-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
const draft = () => ({
  taskId: randomUUID(),
  commandId: randomUUID(),
  title: "提交材料",
  background: "手动输入的背景",
  reminder: { instant: "2026-10-12T16:00:00Z", timeZone: "Asia/Shanghai" },
  deadline: { kind: "date", date: "2026-10-16", timeZone: "Asia/Shanghai" },
});
beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  await migrate(databaseUrl);
  const previousSchema = new pg.Pool({ connectionString: databaseUrl });
  await previousSchema.query(
    "ALTER TABLE reminder DROP CONSTRAINT reminder_scheduling_status_check; ALTER TABLE reminder ADD CONSTRAINT reminder_scheduling_status_check CHECK(scheduling_status='not_scheduled'); DROP TABLE notification_plan_command; DROP TABLE local_occurrence;",
  );
  await previousSchema.end();
  await migrate(databaseUrl);
  app = await createApp(config);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const code = (
    await call("/v1/admin/pairings", "POST", {}, randomUUID(), admin)
  ).body.code;
  const session = (
    await call("/v1/pairings/claim", "POST", { code, deviceName: "test" })
  ).body;
  token = session.accessToken;
  deviceId = session.deviceId;
});
afterAll(async () => {
  await app?.close();
  await maintenance.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await maintenance.end();
});
test("manual task is persistent with independent deadline, evidence and truthful unscheduled reminder", async () => {
  const input = draft();
  const result = await call("/v1/tasks", "POST", input, input.commandId);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    id: input.taskId,
    revision: 1,
    status: "active",
    title: "提交材料",
    deadline: { kind: "date", date: "2026-10-16", timeZone: "Asia/Shanghai" },
    reminder: {
      instant: "2026-10-12T16:00:00.000Z",
      timeZone: "Asia/Shanghai",
      schedulingStatus: "not_scheduled",
    },
    sources: [{ kind: "manual", text: "手动输入的背景" }],
  });
  expect((await call("/v1/tasks/" + input.taskId)).body).toEqual(result.body);
});
test("concurrent retries and command retries yield one task and reject different nested contents", async () => {
  const input = draft(),
    key = randomUUID();
  const results = await Promise.all([
    call("/v1/tasks", "POST", input, key),
    call("/v1/tasks", "POST", input, key),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results[0]!.body).toEqual(results[1]!.body);
  expect((await call("/v1/tasks", "POST", input, randomUUID())).body).toEqual(
    results[0]!.body,
  );
  expect(
    (
      await call(
        "/v1/tasks",
        "POST",
        {
          ...input,
          reminder: { ...input.reminder, instant: "2026-10-13T16:00:00Z" },
        },
        key,
      )
    ).status,
  ).toBe(409);
  expect(
    (await call("/v1/tasks", "POST", { ...draft(), title: input.title }))
      .status,
  ).toBe(200);
});
test("date-only and instant deadlines save without reminders while invalid dates and zones retain no task", async () => {
  for (const deadline of [
    { kind: "date", date: "2028-02-29", timeZone: "America/Los_Angeles" },
    { kind: "instant", instant: "2026-10-17T00:00:00Z", timeZone: "UTC" },
  ]) {
    const input = { ...draft(), reminder: undefined, deadline };
    const r = await call("/v1/tasks", "POST", input);
    expect(r.status).toBe(200);
    expect(r.body.reminder).toBeNull();
    expect(r.body.deadline).toEqual(deadline);
  }
  for (const input of [
    { ...draft(), title: "   " },
    {
      ...draft(),
      deadline: { kind: "date", date: "2027-02-29", timeZone: "UTC" },
    },
    {
      ...draft(),
      reminder: { instant: "2026-10-12T16:00:00Z", timeZone: "Mars/Olympus" },
    },
  ]) {
    expect((await call("/v1/tasks", "POST", input)).status).toBe(422);
    expect((await call("/v1/tasks/" + input.taskId)).status).toBe(404);
  }
});
test("home uses due then next reminder and stable UUID ordering with filtered pagination surviving restart", async () => {
  const inputs = [
    {
      ...draft(),
      taskId: "11111111-1111-4111-8111-111111111111",
      reminder: { instant: "2026-10-11T09:00:00Z", timeZone: "UTC" },
    },
    {
      ...draft(),
      taskId: "22222222-2222-4222-8222-222222222222",
      reminder: { instant: "2026-10-11T09:00:00Z", timeZone: "UTC" },
    },
    {
      ...draft(),
      taskId: "33333333-3333-4333-8333-333333333333",
      reminder: { instant: "2026-10-11T13:00:00Z", timeZone: "UTC" },
    },
  ];
  for (const input of inputs)
    expect((await call("/v1/tasks", "POST", input)).status).toBe(200);
  const first = await call("/v1/tasks?status=active&limit=2");
  expect(first.status).toBe(200);
  expect(first.body.tasks.map((t: any) => t.id)).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  expect(first.body.nextCursor).toBeTypeOf("string");
  await app.close();
  app = await createApp(config);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const second = await call(
    "/v1/tasks?status=active&limit=2&cursor=" +
      encodeURIComponent(first.body.nextCursor),
  );
  expect(second.status).toBe(200);
  expect(second.body.tasks[0].id).toBe("33333333-3333-4333-8333-333333333333");
  expect((await call("/v1/tasks?status=completed")).body.tasks).toEqual([]);
  expect((await call("/v1/tasks?cursor=invalid")).status).toBe(422);
  expect(
    (
      await call(
        "/v1/tasks?status=completed&cursor=" +
          encodeURIComponent(first.body.nextCursor),
      )
    ).status,
  ).toBe(422);
});
test("database commit fault rolls back task, reminder, evidence and command so same identity can retry", async () => {
  const faultDb = new pg.Pool({ connectionString: databaseUrl }),
    input = { ...draft(), localDeviceId: deviceId, quietHoursConfirmed: true };
  try {
    await faultDb.query(
      "CREATE FUNCTION reject_task_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated database commit fault'; END $$; CREATE TRIGGER task_commit_fault BEFORE INSERT ON task_command FOR EACH ROW EXECUTE FUNCTION reject_task_commit();",
    );
    const failed = await call("/v1/tasks", "POST", input, input.commandId);
    expect(failed).toMatchObject({
      status: 503,
      body: { code: "SERVICE_UNAVAILABLE", retryable: true },
    });
    expect((await call("/v1/tasks/" + input.taskId)).status).toBe(404);
    expect(
      (
        await call(`/v1/devices/${deviceId}/notification-plans`)
      ).body.plans.some((p: any) => p.taskId === input.taskId),
    ).toBe(false);
    expect(
      (await call("/v1/tasks?status=all")).body.tasks.some(
        (t: any) => t.id === input.taskId,
      ),
    ).toBe(false);
    await faultDb.query(
      "DROP TRIGGER task_commit_fault ON task_command; DROP FUNCTION reject_task_commit();",
    );
    const retry = await call("/v1/tasks", "POST", input, input.commandId);
    expect(retry.status).toBe(200);
    expect(retry.body.sources).toHaveLength(1);
    expect(retry.body.reminder.schedulingStatus).toBe("local_pending");
    expect(
      (
        await call(`/v1/devices/${deviceId}/notification-plans`)
      ).body.plans.filter((p: any) => p.taskId === input.taskId),
    ).toHaveLength(1);
    expect(
      (await call("/v1/tasks", "POST", input, input.commandId)).body,
    ).toEqual(retry.body);
  } finally {
    await faultDb.end();
  }
});
test("authentication applies to list, detail and create and foreign identity fields are rejected", async () => {
  const input = draft();
  expect(
    (await call("/v1/tasks", "POST", { ...input, ownerId: randomUUID() }))
      .status,
  ).toBe(422);
  expect(
    (await call("/v1/tasks", "POST", input, randomUUID(), "invalid")).status,
  ).toBe(401);
  expect(
    (await call("/v1/tasks", "GET", undefined, randomUUID(), "invalid")).status,
  ).toBe(401);
  expect(
    (
      await call(
        "/v1/tasks/" + randomUUID(),
        "GET",
        undefined,
        randomUUID(),
        "invalid",
      )
    ).status,
  ).toBe(401);
  expect((await call("/v1/tasks/" + randomUUID())).status).toBe(404);
});
test("a new transport key replaying a command remains reserved against another input", async () => {
  const input = draft();
  expect((await call("/v1/tasks", "POST", input)).status).toBe(200);
  const alias = randomUUID();
  expect((await call("/v1/tasks", "POST", input, alias)).status).toBe(200);
  expect((await call("/v1/tasks", "POST", draft(), alias)).status).toBe(409);
});

test("atomic local intent outside rolling window recovers same identity and accepts only current install receipt", async () => {
  const input = {
    ...draft(),
    localDeviceId: deviceId,
    reminder: { instant: "2027-10-12T12:00:00Z", timeZone: "UTC" },
  };
  const saved = await call("/v1/tasks", "POST", input);
  expect(saved.status).toBe(200);
  expect(saved.body.reminder.schedulingStatus).toBe("local_pending");
  const occurrence = saved.body.reminder.occurrence;
  expect(occurrence).toMatchObject({
    reminderRevision: 1,
    routingVersion: 1,
    installationStatus: "pending",
    scheduledAt: "2027-10-12T12:00:00.000Z",
    timeZone: "UTC",
  });
  const path = `/v1/devices/${deviceId}/notification-plans`;
  const pending = await call(path);
  expect(pending.body.plans).toContainEqual({
    taskId: input.taskId,
    ...occurrence,
  });
  await app.close();
  app = await createApp(config);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  expect((await call(path)).body.plans).toContainEqual({
    taskId: input.taskId,
    ...occurrence,
  });
  const receipt = {
    operation: "installed",
    occurrenceId: occurrence.id,
    reminderRevision: 1,
    routingVersion: 1,
    requestId: occurrence.requestId,
  };
  expect(
    (await call(path, "POST", { ...receipt, routingVersion: 2 })).status,
  ).toBe(409);
  expect(
    (await call(path, "POST", { ...receipt, requestId: "wrong" })).status,
  ).toBe(409);
  const installed = await call(path, "POST", receipt);
  expect(installed.body.reminder.schedulingStatus).toBe("local_installed");
  expect((await call(path, "POST", receipt)).body).toEqual(installed.body);
  expect((await call(path)).body.plans).toContainEqual({
    taskId: input.taskId,
    ...installed.body.reminder.occurrence,
  });
  expect(
    (
      await call(
        `/v1/devices/${randomUUID()}/notification-plans`,
        "POST",
        receipt,
      )
    ).status,
  ).toBe(404);
});
test("night reminder stays saved pending explicit confirmation; denied permission and capacity never enable remote fallback", async () => {
  const input = {
    ...draft(),
    localDeviceId: deviceId,
    reminder: {
      instant: "2026-11-01T06:30:00Z",
      timeZone: "America/Los_Angeles",
    },
  };
  const saved = await call("/v1/tasks", "POST", input);
  expect(saved.body.reminder.schedulingStatus).toBe("needs_confirmation");
  const o = saved.body.reminder.occurrence,
    path = `/v1/devices/${deviceId}/notification-plans`;
  const receipt = {
    occurrenceId: o.id,
    reminderRevision: 1,
    routingVersion: 1,
    requestId: o.requestId,
  };
  expect(
    (await call(path, "POST", { ...receipt, operation: "installed" })).status,
  ).toBe(409);
  const confirmed = await call(path, "POST", {
    ...receipt,
    operation: "confirm-quiet-hours",
  });
  expect(confirmed.body.reminder.occurrence.quietHoursConfirmed).toBe(true);
  expect(confirmed.body.reminder.instant).toBe("2026-11-01T06:30:00.000Z");
  for (const [result, status] of [
    ["denied", "permission_denied"],
    ["capacity", "capacity_exceeded"],
    ["failed", "installation_failed"],
  ]) {
    const failed = await call(path, "POST", {
      ...receipt,
      operation: "failed",
      result,
    });
    expect(failed.status).toBe(200);
    expect(failed.body.reminder.schedulingStatus).toBe(status);
    expect(failed.body.reminder.occurrence.id).toBe(o.id);
    expect(
      (await call(path, "POST", { ...receipt, operation: "claim" })).body
        .reminder.schedulingStatus,
    ).toBe(status);
  }
  expect((await call(`/v1/tasks/${input.taskId}`)).body.status).toBe("active");
});
test("old reminder revision and unauthenticated receipts cannot mutate saved reminder", async () => {
  const input = {
    ...draft(),
    localDeviceId: deviceId,
    quietHoursConfirmed: true,
  };
  const saved = await call("/v1/tasks", "POST", input);
  const o = saved.body.reminder.occurrence;
  const wrong = await call(
    `/v1/devices/${deviceId}/notification-plans`,
    "POST",
    {
      operation: "installed",
      occurrenceId: o.id,
      reminderRevision: 2,
      routingVersion: 1,
      requestId: o.requestId,
    },
  );
  expect(wrong.status).toBe(409);
  expect(
    (await call(`/v1/tasks/${input.taskId}`)).body.reminder.schedulingStatus,
  ).toBe("local_pending");
  expect(
    (
      await call(
        `/v1/devices/${deviceId}/notification-plans`,
        "GET",
        undefined,
        randomUUID(),
        "invalid",
      )
    ).status,
  ).toBe(401);
});
test("notification mutation transport keys reserve the exact receipt contents", async () => {
  const saved = await call("/v1/tasks", "POST", {
    ...draft(),
    localDeviceId: deviceId,
    quietHoursConfirmed: true,
  });
  const o = saved.body.reminder.occurrence,
    path = `/v1/devices/${deviceId}/notification-plans`,
    key = randomUUID();
  const receipt = {
    operation: "failed",
    occurrenceId: o.id,
    reminderRevision: 1,
    routingVersion: 1,
    requestId: o.requestId,
    result: "denied",
  };
  const first = await call(path, "POST", receipt, key);
  expect(first.status).toBe(200);
  expect((await call(path, "POST", receipt, key)).body).toEqual(first.body);
  expect(
    (await call(path, "POST", { ...receipt, result: "capacity" }, key)).status,
  ).toBe(409);
  expect(
    (await call(`/v1/tasks/${saved.body.id}`)).body.reminder.schedulingStatus,
  ).toBe("permission_denied");
});

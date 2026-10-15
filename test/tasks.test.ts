import { dropFixtureDatabase } from "./database-cleanup.js";
import { beforeAll, afterAll, test, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
const rootUrl =
  process.env.DATABASE_URL ??
  "postgres://haiji:haiji@127.0.0.1:55432/haiji_test";
const name = "tasks_" + randomUUID().replaceAll("-", "");
const url = new URL(rootUrl);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  maintenance = new pg.Pool({ connectionString: rootUrl });
const admin = "t".repeat(48);
const config = {
  databaseUrl,
  adminSecret: admin,
  publicUrl: "https://haiji.example",
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
    "ALTER TABLE reminder DROP CONSTRAINT reminder_scheduling_status_check; ALTER TABLE reminder ADD CONSTRAINT reminder_scheduling_status_check CHECK(scheduling_status='not_scheduled'); ",
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
  await dropFixtureDatabase(maintenance, name);
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
      schedulingStatus: "needs_confirmation",
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
      reminder: { instant: "2026-10-11T12:30:00Z", timeZone: "UTC" },
    },
    {
      ...draft(),
      taskId: "22222222-2222-4222-8222-222222222222",
      reminder: { instant: "2026-10-11T12:30:00Z", timeZone: "UTC" },
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
    input = { ...draft(), quietHoursConfirmed: true };
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
    expect(retry.body.reminder.schedulingStatus).toBe("remote_planned");
    expect(retry.body.reminder.remoteOccurrence.deliveryOwner).toBe("server");
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

test("task completion is retry safe, invalidates plans and supports causal undo", async () => {
  const saved = await call("/v1/tasks", "POST", {
    ...draft(),

    quietHoursConfirmed: true,
  });
  const command = {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 1,
    operation: "complete",
  };
  const path = `/v1/tasks/${saved.body.id}/commands`;
  const done = await call(path, "POST", command, command.commandId);
  expect(done.status).toBe(200);
  expect(done.body).toMatchObject({
    status: "completed",
    revision: 2,
    reminder: null,
  });
  expect((await call(path, "POST", command)).body).toEqual(done.body);
  expect(
    (await call(`/v1/devices/${deviceId}/notification-plans`)).status,
  ).toBe(404);
  const restored = await call(path, "POST", {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 2,
    operation: "undo",
    targetMutationId: command.clientMutationId,
  });
  expect(restored.status).toBe(200);
  expect(restored.body).toMatchObject({
    status: "active",
    revision: 3,
    reminder: { revision: 3, instant: saved.body.reminder.instant },
  });
});

test("concurrent terminal commands cannot resurrect tasks, snooze preserves deadline and stale notification is read only", async () => {
  const saved = await call("/v1/tasks", "POST", {
    ...draft(),

    quietHoursConfirmed: true,
  });
  const path = `/v1/tasks/${saved.body.id}/commands`;
  const action = (operation: string, expectedRevision: number, extra = {}) => ({
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision,
    operation,
    ...extra,
  });
  const old = saved.body.reminder.remoteOccurrence;
  const snooze = await call(
    path,
    "POST",
    action("snooze", 1, {
      reminder: { instant: "2026-10-18T12:00:00Z", timeZone: "UTC" },
    }),
  );
  expect(snooze.body).toMatchObject({
    revision: 2,
    deadline: saved.body.deadline,
    reminder: { revision: 2, instant: "2026-10-18T12:00:00.000Z" },
  });
  expect(
    (
      await call(
        path,
        "POST",
        action("snooze", 2, {
          occurrence: {
            id: old.id,
            reminderRevision: 1,
            routingVersion: 1,
            requestId: "haiji.remote." + old.id + ".1",
          },
          reminder: { instant: "2026-10-19T12:00:00Z", timeZone: "UTC" },
        }),
      )
    ).status,
  ).toBe(409);
  const terminal = await Promise.all(
    ["complete", "cancel"].map((op) => call(path, "POST", action(op, 2))),
  );
  expect(terminal.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await call(path, "POST", action("edit", 3, { title: "revive" }))).status,
  ).toBe(409);
  const latest = await call(`/v1/tasks/${saved.body.id}`);
  expect(latest.body.revision).toBe(3);
  expect(latest.body.reminder).toBeNull();
  const restore = await call(path, "POST", action("restore", 3));
  expect(restore.body.status).toBe("active");
});

test("causal undo refuses later changes, mutation/body conflicts and expired restoration requires a new time", async () => {
  const saved = await call("/v1/tasks", "POST", {
    ...draft(),
    reminder: { instant: "2026-10-12T12:00:00Z", timeZone: "UTC" },
  });
  const past = new pg.Pool({ connectionString: databaseUrl });
  await past.query(
    "UPDATE reminder SET instant='2026-10-10T12:00:00Z' WHERE task_id=$1",
    [saved.body.id],
  );
  await past.end();
  const path = `/v1/tasks/${saved.body.id}/commands`,
    mutation = randomUUID();
  const done = {
    commandId: randomUUID(),
    clientMutationId: mutation,
    expectedRevision: 1,
    operation: "cancel",
  };
  expect((await call(path, "POST", done)).status).toBe(200);
  expect(
    (await call(path, "POST", { ...done, operation: "complete" })).status,
  ).toBe(409);
  expect(
    (
      await call(path, "POST", {
        commandId: randomUUID(),
        clientMutationId: randomUUID(),
        expectedRevision: 2,
        operation: "restore",
      })
    ).body.code,
  ).toBe("NEW_REMINDER_TIME_REQUIRED");
  const restored = await call(path, "POST", {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 2,
    operation: "restore",
    reminder: { instant: "2026-10-12T12:00:00Z", timeZone: "UTC" },
  });
  expect(restored.status).toBe(200);
  const undo = await call(path, "POST", {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 3,
    operation: "undo",
    targetMutationId: mutation,
  });
  expect(undo.body.code).toBe("UNDO_CONFLICT");
});

test("action commit fault leaves current task and notification plan unchanged and permits same command retry", async () => {
  const saved = await call("/v1/tasks", "POST", {
    ...draft(),

    quietHoursConfirmed: true,
  });
  const db = new pg.Pool({ connectionString: databaseUrl });
  const command = {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 1,
    operation: "complete",
  };
  const path = `/v1/tasks/${saved.body.id}/commands`;
  try {
    await db.query(
      "CREATE FUNCTION reject_action_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated action commit fault'; END $$; CREATE TRIGGER action_commit_fault BEFORE INSERT ON task_change_log FOR EACH ROW EXECUTE FUNCTION reject_action_commit();",
    );
    expect((await call(path, "POST", command)).status).toBe(503);
    expect((await call(`/v1/tasks/${saved.body.id}`)).body).toEqual(saved.body);
    expect(
      (await call(`/v1/tasks/${saved.body.id}`)).body.reminder.remoteOccurrence,
    ).toEqual(saved.body.reminder.remoteOccurrence);
    await db.query(
      "DROP TRIGGER action_commit_fault ON task_change_log; DROP FUNCTION reject_action_commit();",
    );
    expect((await call(path, "POST", command)).body).toMatchObject({
      status: "completed",
      revision: 2,
    });
  } finally {
    await db.end();
  }
});

test("editing deadline and removing reminder remains removed after terminal restoration", async () => {
  const saved = await call("/v1/tasks", "POST", draft()),
    path = `/v1/tasks/${saved.body.id}/commands`;
  const act = (operation: string, expectedRevision: number, extra = {}) => ({
    operation,
    expectedRevision,
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    ...extra,
  });
  const edit = await call(
    path,
    "POST",
    act("edit", 1, { deadline: null, reminder: null, title: "无需提醒的材料" }),
  );
  expect(edit.body).toMatchObject({
    deadline: null,
    reminder: null,
    title: "无需提醒的材料",
    revision: 2,
  });
  expect((await call(path, "POST", act("cancel", 2))).status).toBe(200);
  const restore = await call(path, "POST", act("restore", 3));
  expect(restore.body).toMatchObject({
    status: "active",
    revision: 4,
    reminder: null,
    deadline: null,
  });
});

test("metadata edits after a reminder elapsed preserve the task without sending a new notification", async () => {
  const saved = await call("/v1/tasks", "POST", draft());
  const db = new pg.Pool({ connectionString: databaseUrl });
  await db.query(
    "UPDATE reminder SET instant='2026-10-10T12:00:00Z' WHERE task_id=$1",
    [saved.body.id],
  );
  await db.end();
  const edited = await call(`/v1/tasks/${saved.body.id}/commands`, "POST", {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: 1,
    operation: "edit",
    title: "updated after reminder",
  });
  expect(edited.status).toBe(200);
  expect(edited.body.reminder.remoteOccurrence.status).toBe("expired");
});

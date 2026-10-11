import { dropFixtureDatabase } from "./database-cleanup.js";
import { createServer } from "node:http";
import { startAgentWorker } from "../src/agent-worker.js";
import { beforeAll, afterAll, test, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
const rootUrl =
  process.env.DATABASE_URL ??
  "postgres://nivli:nivli@127.0.0.1:55432/nivli_test";
const name = "agent_" + randomUUID().replaceAll("-", "");
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
let fixtureMode = "valid",
  fixtureOverride: Record<string, unknown> | undefined;
let provider: ReturnType<typeof createServer>,
  worker: Awaited<ReturnType<typeof startAgentWorker>>,
  payloads: Record<string, unknown>[] = [];
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
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = JSON.parse(body);
    payloads.push(p);
    if (fixtureMode === "unavailable") {
      res.writeHead(503);
      res.end();
      return;
    }
    if (fixtureMode === "timeout") {
      setTimeout(() => res.end(), 1000);
      return;
    }
    const args = {
      title: "提交材料",
      instant: "2026-10-12T01:00:00Z",
      timeZone: "Asia/Shanghai",
      instruction: "明天上午9点提醒我提交材料",
      timeExpression: "明天上午9点",
      localDateTime: "2026-10-12T09:00:00",
      ...fixtureOverride,
    };
    const events = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 20, output_tokens: 0 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "call_test",
            name: fixtureMode === "unknown" ? "read_file" : "propose_reminder",
            input: {},
          },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(args),
          },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 30 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ];
    if (fixtureMode === "batch")
      for (let index = 1; index < 7; index++)
        events.splice(
          events.length - 2,
          0,
          [
            "content_block_start",
            {
              type: "content_block_start",
              index,
              content_block: {
                type: "tool_use",
                id: "batch_" + index,
                name: "propose_reminder",
                input: {},
              },
            },
          ],
          [
            "content_block_delta",
            {
              type: "content_block_delta",
              index,
              delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify(args),
              },
            },
          ],
          ["content_block_stop", { type: "content_block_stop", index }],
        );
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [event, data] of events)
      res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    res.end();
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const model = {
    model: "claude-sonnet-5-5",
    apiKey: "external-fixture-key",
    baseUrl:
      "http://127.0.0.1:" + (provider.address() as { port: number }).port,
  };
  app = await createApp({ ...config, model });
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
  await worker?.stop();
  await app?.close();
  await new Promise<void>((r) => provider.close(() => r()));
  await dropFixtureDatabase(maintenance, name);
  await maintenance.end();
});
test("durable instruction returns a queued run and never a fictional saved entity", async () => {
  const key = randomUUID(),
    body = { text: "明天上午9点提醒我提交材料", timeZone: "Asia/Shanghai" };
  const queued = await call("/v1/inputs", "POST", body, key);
  expect(queued.status).toBe(202);
  expect((await call("/v1/inputs", "POST", body, key)).body).toEqual(
    queued.body,
  );
  expect((await call("/v1/runs/" + queued.body.runId)).body).toMatchObject({
    status: "queued",
    inputId: queued.body.inputId,
  });
  expect((await call("/v1/tasks")).body.tasks).toHaveLength(0);
});

test("released Pi consumes strict Claude tool output and creates a real source-backed reminder and installation receipt", async () => {
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    },
  });
  const queued = await call("/v1/inputs", "POST", {
    text: "明天上午9点提醒我提交材料",
    timeZone: "Asia/Shanghai",
  });
  let run;
  for (let i = 0; i < 100; i++) {
    run = (await call("/v1/runs/" + queued.body.runId)).body;
    if (!["queued", "running"].includes(run.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(run).toMatchObject({ status: "succeeded" });
  const task = (await call("/v1/tasks/" + run.taskId)).body;
  expect(task).toMatchObject({
    title: "提交材料",
    sources: [{ kind: "instruction", text: "明天上午9点提醒我提交材料" }],
    reminder: {
      instant: "2026-10-12T01:00:00.000Z",
      schedulingStatus: "local_pending",
    },
  });
  const o = task.reminder.occurrence;
  const installed = await call(
    "/v1/devices/" + deviceId + "/notification-plans",
    "POST",
    {
      operation: "installed",
      occurrenceId: o.id,
      reminderRevision: o.reminderRevision,
      routingVersion: o.routingVersion,
      requestId: o.requestId,
    },
  );
  expect(installed.body.reminder.schedulingStatus).toBe("local_installed");
  expect(payloads[0]).toMatchObject({
    thinking: { type: "between_tools" },
    output_config: { effort: "low" },
    max_tokens: 1024,
    tool_choice: { type: "auto" },
    tools: [
      { strict: true, input_schema: { additionalProperties: false } },
      { strict: true },
      { strict: true },
    ],
  });
});

async function settle(id: string) {
  let run;
  for (let i = 0; i < 120; i++) {
    run = (await call("/v1/runs/" + id)).body;
    if (!["queued", "running"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("run did not settle");
}
async function submit(
  text = "明天上午9点提醒我提交材料",
  timeZone = "Asia/Shanghai",
) {
  const q = await call("/v1/inputs", "POST", { text, timeZone });
  return settle(q.body.runId);
}
test("invalid, invented-authority, ambiguous and wish proposals cannot create business entities", async () => {
  for (const [text, override] of [
    ["明天上午9点提醒我提交材料", { instant: "2026-10-12T02:00:00Z" }],
    ["明天上午9点提醒我提交材料", { ownerId: randomUUID() }],
    [
      "希望明天有空提交材料",
      { instruction: "希望明天有空提交材料", timeExpression: "明天" },
    ],
    [
      "周日提醒我提交材料",
      { instruction: "周日提醒我提交材料", timeExpression: "周日" },
    ],
  ] as const) {
    fixtureOverride = override;
    const run = await submit(text);
    expect(run.taskId).toBeUndefined();
    expect(["failed", "needs_clarification"]).toContain(run.status);
  }
  fixtureOverride = undefined;
});
test("DST repeated clocks require clarification instead of choosing an offset", async () => {
  fixtureOverride = {
    title: "检查",
    instruction: "2026-11-01 1:30提醒我检查",
    timeExpression: "2026-11-01 1:30",
    instant: "2026-11-01T08:30:00Z",
    localDateTime: "2026-11-01T01:30:00",
    timeZone: "America/Los_Angeles",
  };
  const run = await submit("2026-11-01 1:30提醒我检查", "America/Los_Angeles");
  expect(run.status).toBe("needs_clarification");
  expect(run.taskId).toBeUndefined();
  fixtureOverride = undefined;
});
test("unknown tool attempts consume the real request budget without exposing file or shell tools", async () => {
  fixtureMode = "unknown";
  const run = await submit();
  expect(run).toMatchObject({ status: "failed", requests: 3, toolCalls: 3 });
  expect(run.taskId).toBeUndefined();
  fixtureMode = "valid";
});
test("provider failure has no hidden HTTP retries and retry keeps the durable input identity", async () => {
  fixtureMode = "unavailable";
  const before = payloads.length,
    run = await submit();
  expect(run.status).toBe("failed");
  expect(payloads.length - before).toBe(1);
  fixtureMode = "valid";
  const key = randomUUID(),
    q = await call("/v1/runs/" + run.id + "/retry", "POST", {}, key);
  expect(q.body).toMatchObject({ inputId: run.inputId, runId: run.id });
  const saved = await settle(run.id);
  expect(saved.status).toBe("succeeded");
  await call("/v1/runs/" + run.id + "/retry", "POST", {}, key);
  expect((await call("/v1/runs/" + run.id)).body.taskId).toBe(saved.taskId);
});
test("foreign run IDs and changed idempotent input are rejected, model keys never reach clients", async () => {
  expect((await call("/v1/runs/" + randomUUID())).status).toBe(404);
  const key = randomUUID();
  await call(
    "/v1/inputs",
    "POST",
    { text: "明天上午9点提醒我提交材料", timeZone: "Asia/Shanghai" },
    key,
  );
  expect(
    (
      await call(
        "/v1/inputs",
        "POST",
        { text: "不同原话", timeZone: "Asia/Shanghai" },
        key,
      )
    ).status,
  ).toBe(409);
  const model = await call("/v1/model");
  expect(model.body).toMatchObject({
    configured: true,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  });
  expect(JSON.stringify(model.body)).not.toContain("external-fixture-key");
  expect((await call("/v1/admin/model/test", "POST", {})).status).toBe(401);
});

test("seven raw tool calls abort the whole batch before any business commit", async () => {
  fixtureMode = "batch";
  const run = await submit();
  expect(run).toMatchObject({ status: "failed", requests: 1, toolCalls: 7 });
  expect(run.taskId).toBeUndefined();
  fixtureMode = "valid";
});

test("raw numeric values cannot be normalized into authorization and no late task survives timeout", async () => {
  fixtureOverride = { title: 42 };
  const invalid = await submit();
  expect(invalid.taskId).toBeUndefined();
  fixtureOverride = undefined;
  await worker.stop();
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      timeoutMs: 100,
    },
  });
  fixtureMode = "timeout";
  const run = await submit();
  expect(run.status).toBe("timed_out");
  expect(run.taskId).toBeUndefined();
  await new Promise((r) => setTimeout(r, 1100));
  expect((await call("/v1/runs/" + run.id)).body.status).toBe("timed_out");
  fixtureMode = "valid";
}, 15000);

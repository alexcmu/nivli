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
const name = "conversation_" + randomUUID().replaceAll("-", "");
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
let fixtureMode = "clarification",
  fixtureOverride: Record<string, unknown> | undefined;
let fixtureWait: Promise<void> | undefined;
let provider: ReturnType<typeof createServer>,
  worker: Awaited<ReturnType<typeof startAgentWorker>> | undefined,
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
    if (fixtureWait) await fixtureWait;
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
            name:
              fixtureMode === "modify"
                ? "propose_change"
                : fixtureMode === "clarification"
                  ? "ask_clarification"
                  : "propose_reminder",
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
            partial_json: JSON.stringify(
              fixtureMode === "modify"
                ? {
                    taskId: fixtureOverride?.taskId,
                    expectedRevision: fixtureOverride?.expectedRevision,
                    operation: fixtureOverride?.operation,
                    instruction: fixtureOverride?.instruction,
                    instant: fixtureOverride?.instant,
                    timeZone: fixtureOverride?.timeZone ?? "Asia/Shanghai",
                    timeExpression: fixtureOverride?.timeExpression,
                    localDateTime: fixtureOverride?.localDateTime,
                  }
                : fixtureMode === "clarification"
                  ? { message: "请问几点提醒？" }
                  : args,
            ),
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
                partial_json: JSON.stringify(
                  fixtureMode === "clarification"
                    ? { message: "请问几点提醒？" }
                    : args,
                ),
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
  await maintenance.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await maintenance.end();
});

async function settle(id: string) {
  for (let n = 0; n < 120; n++) {
    const run = (await call("/v1/runs/" + id)).body;
    if (!["queued", "running"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("run not settled");
}
test("clarification answers preserve a durable bounded conversation across server and worker restart", async () => {
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    },
  });
  const first = await call("/v1/inputs", "POST", {
    text: "明天提醒我提交材料",
    timeZone: "Asia/Shanghai",
  });
  const run = await settle(first.body.runId);
  expect(["clarification", "needs_clarification"]).toContain(run.status);
  expect(first.body.conversationId).toBeTypeOf("string");
  const history = await call("/v1/conversations/" + first.body.conversationId);
  expect(history.body.messages).toMatchObject([
    {
      text: "明天提醒我提交材料",
      inputId: first.body.inputId,
      status: run.status,
    },
  ]);
  await worker.stop();
  worker = undefined;
  await app.close();
  app = await createApp({ ...config });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const restored = await call("/v1/conversations/" + first.body.conversationId);
  expect(restored.body).toEqual(history.body);
});

test("linked time answer uses original instruction without creating duplicate tasks", async () => {
  const model = {
    model: "claude-sonnet-5-5",
    apiKey: "external-fixture-key",
    baseUrl:
      "http://127.0.0.1:" + (provider.address() as { port: number }).port,
  };
  worker = await startAgentWorker({ ...config, model });
  fixtureMode = "clarification";
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  await settle(first.runId);
  fixtureMode = "valid";
  fixtureOverride = { instruction: "上午9点", timeExpression: "上午9点" };
  const answer = (
    await call("/v1/inputs", "POST", {
      text: "上午9点",
      timeZone: "Asia/Shanghai",
      conversationId: first.conversationId,
      replyToInputId: first.inputId,
    })
  ).body;
  const run = await settle(answer.runId);
  expect(run.status).toBe("succeeded");
  const task = (await call("/v1/tasks/" + run.taskId)).body;
  expect(task.reminder.instant).toBe("2026-10-12T01:00:00.000Z");
  expect(task.sources[0].text).toContain("明天提醒我提交材料");
  expect(task.sources[0].text).toContain("上午9点");
  expect(JSON.stringify(payloads.at(-1))).toContain(first.inputId);
  fixtureOverride = undefined;
});

test("serial conversation changes target the latest committed revision and old cards read current state", async () => {
  fixtureMode = "valid";
  fixtureOverride = undefined;
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  const created = await settle(first.runId);
  fixtureMode = "modify";
  fixtureOverride = {
    taskId: created.taskId,
    expectedRevision: "1",
    operation: "edit",
    instruction: "改成九点半",
    timeExpression: "九点半",
    instant: "2026-10-12T01:30:00Z",
    localDateTime: "2026-10-12T09:30:00",
  };
  const q = (
    await call("/v1/inputs", "POST", {
      text: "改成九点半",
      timeZone: "Asia/Shanghai",
      conversationId: first.conversationId,
    })
  ).body;
  const changed = await settle(q.runId);
  expect(changed.status).toBe("succeeded");
  expect(changed.taskId).toBe(created.taskId);
  const history = (await call("/v1/conversations/" + first.conversationId))
    .body;
  expect(history.messages[0].task).toMatchObject({
    revision: 2,
    reminder: { instant: "2026-10-12T01:30:00.000Z" },
  });
  fixtureMode = "valid";
  fixtureOverride = undefined;
});

test("a persisted expected revision rejects a late edit and preserves original words with current terminal state", async () => {
  fixtureMode = "valid";
  fixtureOverride = undefined;
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  const created = await settle(first.runId);
  let release!: () => void;
  fixtureWait = new Promise<void>((r) => (release = r));
  fixtureMode = "modify";
  fixtureOverride = {
    taskId: created.taskId,
    expectedRevision: "1",
    operation: "edit",
    instruction: "改成9:30",
    timeExpression: "9:30",
    instant: "2026-10-12T01:30:00Z",
    localDateTime: "2026-10-12T09:30:00",
  };
  const before = payloads.length;
  const q = (
    await call("/v1/inputs", "POST", {
      text: "改成9:30",
      timeZone: "Asia/Shanghai",
      conversationId: first.conversationId,
    })
  ).body;
  for (let n = 0; n < 100 && payloads.length === before; n++)
    await new Promise((r) => setTimeout(r, 30));
  expect(payloads.length).toBeGreaterThan(before);
  const completed = await call(
    "/v1/tasks/" + created.taskId + "/commands",
    "POST",
    {
      commandId: randomUUID(),
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      operation: "complete",
    },
  );
  expect(completed.status).toBe(200);
  fixtureWait = undefined;
  release();
  const stale = await settle(q.runId);
  expect(["clarification", "needs_clarification"]).toContain(stale.status);
  expect((await call("/v1/tasks/" + created.taskId)).body).toMatchObject({
    status: "completed",
    revision: 2,
  });
  const history = (await call("/v1/conversations/" + first.conversationId))
    .body;
  expect(history.messages.at(-1).text).toBe("改成9:30");
  expect(history.messages[0].task.status).toBe("completed");
  fixtureMode = "valid";
  fixtureOverride = undefined;
});

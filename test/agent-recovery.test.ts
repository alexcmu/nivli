import { spawn, execFileSync } from "node:child_process";
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
const name = "agent09_" + randomUUID().replaceAll("-", "");
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
            usage: {
              input_tokens: fixtureMode === "budget" ? 65536 : 20,
              output_tokens: 0,
            },
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
          usage: { output_tokens: fixtureMode === "budget" ? 512 : 30 },
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
    if (fixtureMode === "budget") await new Promise((r) => setTimeout(r, 300));
    if (fixtureMode === "late") await new Promise((r) => setTimeout(r, 1000));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [event, data] of events)
      res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    res.end();
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const model = {
    model: "claude-sonnet-5-5",
    apiKey: "external-fixture-key",
    dailyBudgetUsd:0.15,
    baseUrl:
      "http://127.0.0.1:" + (provider.address() as { port: number }).port,
  };
  app = await createApp({ ...config, model });
  worker = await startAgentWorker({ ...config, model });
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
test("daily budget serializes concurrent requests, reports estimates separately, and leaves manual API operational", async () => {
  await worker.stop();
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      dailyBudgetUsd: 0.15,
      maxOutputTokens: 512,
    },
  });
  fixtureMode = "budget";
  const competing = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      dailyBudgetUsd: 0.15,
      maxOutputTokens: 512,
    },
  });
  const before = payloads.length;
  const qs = await Promise.all(
    Array.from({ length: 3 }, () =>
      call("/v1/inputs", "POST", {
        text: "明天上午9点提醒我提交材料",
        timeZone: "Asia/Shanghai",
      }),
    ),
  );
  const runs = await Promise.all(qs.map((q) => settle(q.body.runId)));
  await competing.stop();
  expect(payloads.length - before).toBe(1);
  expect(runs.filter((r) => r.status === "succeeded")).toHaveLength(1);
  expect(
    runs.filter((r) => r.errorCode === "MODEL_BUDGET_EXHAUSTED"),
  ).toHaveLength(2);
  expect((await call("/v1/tasks", "POST", draft())).status).toBe(200);
  const budget = await call(
    "/v1/admin/model/budget",
    "GET",
    undefined,
    randomUUID(),
    admin,
  );
  expect(budget.body).toMatchObject({ invoiceAvailable: false, requests: 1 });
  const check=await call('/v1/admin/model/test','POST',{},randomUUID(),admin);
  expect(check).toMatchObject({status:409,body:{code:'MODEL_BUDGET_EXHAUSTED'}});
  expect(payloads.length-before).toBe(1);
  expect(budget.body.reservedUsd).toBeGreaterThan(0);
  expect(budget.body.usageUsd).toBeGreaterThan(0);
  expect(payloads.at(-1)?.max_tokens).toBe(512);
  fixtureMode = "valid";
  await worker.stop();
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    },
  });
});
test("cancelled run preserves original input and prevents late provider output and new requests", async () => {
  fixtureMode = "late";
  const previousTasks = (await call("/v1/tasks")).body.tasks.length;
  const queued = await call("/v1/inputs", "POST", {
    text: "明天上午9点提醒我提交材料",
    timeZone: "Asia/Shanghai",
  });
  for (let i = 0; i < 100; i++) {
    if ((await call("/v1/runs/" + queued.body.runId)).body.status === "running")
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  for(let i=0;i<100;i++){if((await call('/v1/runs/'+queued.body.runId)).body.requests>0)break;await new Promise(r=>setTimeout(r,20));}
  const key = randomUUID();
  const cancel = await call(
    "/v1/runs/" + queued.body.runId + "/cancel",
    "POST",
    {},
    key,
  );
  expect(cancel.status).toBe(200);
  expect(cancel.body).toMatchObject({
    status: "cancelled",
    cost:{invoiceAvailable:false,unknownRequests:1},
    requests:1,
    text: "明天上午9点提醒我提交材料",
    timeZone: "Asia/Shanghai",
  });
  expect(
    (await call("/v1/runs/" + queued.body.runId + "/cancel", "POST", {}, key))
      .body.status,
  ).toBe("cancelled");
  const before = payloads.length;
  await new Promise((r) => setTimeout(r, 1200));
  expect(payloads.length).toBe(before);
  expect((await call("/v1/tasks")).body.tasks).toHaveLength(previousTasks);
  fixtureMode = "valid";
});

test("hard deadline returns timed_out, retained input retries with stable identity, and succeeded cancellation cannot undo a task", async () => {
  await worker.stop();
  const model = {
    model: "claude-sonnet-5-5",
    apiKey: "external-fixture-key",
    baseUrl:
      "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    timeoutMs: 100,
  };
  worker = await startAgentWorker({ ...config, model });
  fixtureMode = "late";
  const q = await call("/v1/inputs", "POST", {
    text: "明天上午9点提醒我提交材料",
    timeZone: "Asia/Shanghai",
  });
  const r = await settle(q.body.runId);
  expect(r).toMatchObject({
    status: "timed_out",
    errorCode: "MODEL_TIMEOUT",
    text: "明天上午9点提醒我提交材料",
  });
  await new Promise((r) => setTimeout(r, 1100));
  expect((await call("/v1/runs/" + r.id)).body.status).toBe("timed_out");
  fixtureMode = "valid";
  await worker.stop();
  worker = await startAgentWorker({
    ...config,
    model: { ...model, timeoutMs: 60000 },
  });
  const retry = await call("/v1/runs/" + r.id + "/retry", "POST", {});
  expect(retry.body).toMatchObject({ inputId: r.inputId, runId: r.id });
  const saved = await settle(r.id);
  expect(saved.status).toBe("succeeded");
  const cancelled = await call("/v1/runs/" + r.id + "/cancel", "POST", {});
  expect(cancelled.body).toMatchObject({
    status: "succeeded",
    taskId: saved.taskId,
  });
  expect((await call("/v1/tasks/" + saved.taskId)).status).toBe(200);
});

test("a killed worker redelivers an unconfirmed request and never duplicates the business result after a committed run", async () => {
  await worker.stop();
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  const model = {
    model: "claude-sonnet-5-5",
    apiKey: "external-fixture-key",
    baseUrl:
      "http://127.0.0.1:" + (provider.address() as { port: number }).port,
  };
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {startAgentWorker} from './dist/agent-worker.js';await startAgentWorker(${JSON.stringify({ ...config, clock: undefined, model })});`,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  fixtureMode = "late";
  const before = payloads.length,
    q = await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    });
  for (let i = 0; i < 100 && payloads.length === before; i++)
    await new Promise((r) => setTimeout(r, 50));
  expect(payloads.length).toBe(before + 1);
  const ended = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await ended;
  fixtureMode = "valid";
  worker = await startAgentWorker({ ...config, model });
  const saved = await settle(q.body.runId);
  expect(saved.status).toBe("succeeded");
  expect(payloads.length - before).toBe(2);
  expect(saved.taskId).toBe(q.body.inputId);
  await worker.stop();
  worker = await startAgentWorker({ ...config, model });
  await new Promise((r) => setTimeout(r, 800));
  expect((await call("/v1/runs/" + saved.id)).body.taskId).toBe(saved.taskId);
  expect(payloads.length - before).toBe(2);
  expect(
    (await call("/v1/tasks")).body.tasks.filter(
      (t: { id: string }) => t.id === saved.taskId,
    ),
  ).toHaveLength(1);
}, 20000);

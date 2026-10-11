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
const name = "conversation_" + randomUUID().replaceAll("-", "");
const url = new URL(rootUrl);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  maintenance = new pg.Pool({ connectionString: rootUrl });
const admin = "t".repeat(48);
let currentInstant = "2026-10-11T12:00:00Z";
const config = {
  databaseUrl,
  adminSecret: admin,
  publicUrl: "https://nivli.example",
  environmentName: "Tasks",
  pushMode: "disabled" as const,
  modelDataDestination: "None",
  clock: () => new Date(currentInstant),
};
let fixtureMode = "clarification",
  fixtureOverride: Record<string, unknown> | undefined;
let fixtureWait: Promise<void> | undefined;
let fixtureSequence: Record<string, unknown>[] = [];
let provider: ReturnType<typeof createServer>,
  worker: Awaited<ReturnType<typeof startAgentWorker>> | undefined,
  payloads: Record<string, unknown>[] = [];
let app: Awaited<ReturnType<typeof createApp>>,
  base = "",
  token = "",
  refreshToken = "",
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
    if (fixtureSequence.length) fixtureOverride = fixtureSequence.shift();
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
  refreshToken = session.refreshToken;
  deviceId = session.deviceId;
});
afterAll(async () => {
  await worker?.stop();
  await app?.close();
  await new Promise<void>((r) => provider.close(() => r()));
  await dropFixtureDatabase(maintenance, name);
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
  expect(task.reminder.originalExpression).toContain("明天提醒我提交材料");
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

test("concurrently accepted conversation inputs commit strictly in their persisted revision order", async () => {
  fixtureMode = "valid";
  fixtureOverride = undefined;
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  const created = await settle(first.runId);
  const change = {
    taskId: created.taskId,
    operation: "edit",
    instruction: "改成9:30",
    timeExpression: "9:30",
    instant: "2026-10-12T01:30:00Z",
    localDateTime: "2026-10-12T09:30:00",
  };
  fixtureMode = "modify";
  fixtureSequence = [
    { ...change, expectedRevision: "1" },
    { ...change, expectedRevision: "2" },
  ];
  const inputs = await Promise.all(
    [1, 2].map(() =>
      call("/v1/inputs", "POST", {
        text: "改成9:30",
        timeZone: "Asia/Shanghai",
        conversationId: first.conversationId,
      }),
    ),
  );
  const runs = await Promise.all(inputs.map((q) => settle(q.body.runId)));
  expect(runs.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
  const history = (await call("/v1/conversations/" + first.conversationId))
    .body;
  expect(history.revision).toBe(3);
  expect(history.acceptedRevision).toBe(3);
  expect(history.messages.map((m: any) => m.revision)).toEqual([1, 2, 3]);
  expect(history.messages[0].task.revision).toBe(3);
  fixtureMode = "valid";
  fixtureOverride = undefined;
});
test("several task references require explicit identity and selected task edits preserve deadline and original timezone during travel", async () => {
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  fixtureOverride = {
    deadlineDate: "2026-10-16",
    deadlineExpression: "截止2026-10-16",
    instruction: "明天上午9点提醒我提交材料，截止2026-10-16",
  };
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料，截止2026-10-16",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  const created = await settle(first.runId);
  fixtureOverride = { title: "买牛奶", instruction: "明天上午9点提醒我买牛奶" };
  const second = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我买牛奶",
      timeZone: "Asia/Shanghai",
      conversationId: first.conversationId,
    })
  ).body;
  expect((await settle(second.runId)).status).toBe("succeeded");
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
  const ambiguous = (
    await call("/v1/inputs", "POST", {
      text: "改成9:30",
      timeZone: "America/New_York",
      conversationId: first.conversationId,
    })
  ).body;
  expect((await settle(ambiguous.runId)).status).toBe("needs_clarification");
  const selected = (
    await call("/v1/inputs", "POST", {
      text: "改成9:30",
      timeZone: "America/New_York",
      conversationId: first.conversationId,
      taskId: created.taskId,
    })
  ).body;
  expect((await settle(selected.runId)).status).toBe("succeeded");
  const task = (await call("/v1/tasks/" + created.taskId)).body;
  expect(task).toMatchObject({
    revision: 2,
    deadline: { date: "2026-10-16", timeZone: "Asia/Shanghai" },
    reminder: {
      instant: "2026-10-12T01:30:00.000Z",
      timeZone: "Asia/Shanghai",
    },
  });
  fixtureMode = "valid";
  fixtureOverride = undefined;
}, 15000);
test("vague postponement, unspecified Friday and nonexistent DST clocks cannot create definite reminders", async () => {
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  for (const [text, timeZone, override] of [
    ["晚点提醒我提交材料", "Asia/Shanghai", { timeExpression: "晚点" }],
    ["周五提醒我提交材料", "Asia/Shanghai", { timeExpression: "周五" }],
    [
      "2027-03-14 2:30提醒我检查",
      "America/Los_Angeles",
      {
        title: "检查",
        timeExpression: "2027-03-14 2:30",
        instant: "2027-03-14T10:30:00Z",
        localDateTime: "2027-03-14T02:30:00",
      },
    ],
  ] as const) {
    fixtureOverride = { ...override, timeZone, instruction: text };
    const q = (await call("/v1/inputs", "POST", { text, timeZone })).body;
    const run = await settle(q.runId);
    expect(run.status).toBe("needs_clarification");
    expect(run.taskId).toBeUndefined();
  }
  fixtureOverride = undefined;
}, 15000);

test("negated and conditional instructions cannot authorize provider-proposed mutations, while factual completion can", async () => {
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  fixtureOverride = undefined;
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  const created = await settle(first.runId);
  const original = (await call("/v1/tasks/" + created.taskId)).body;
  fixtureMode = "modify";
  for (const [text, operation] of [
    ["这个还没完成", "complete"],
    ["尚未取消", "cancel"],
    ["如果下雨再取消", "cancel"],
    ["not completed", "complete"],
    ["unfinished", "complete"],
    ["If it rains cancel it", "cancel"],
    ["如果下雨改成9:30", "edit"],
    ["未做完", "complete"],
    ["没完成", "complete"],
    ["It isn't completed", "complete"],
    ["下雨了就取消", "cancel"],
    ["取消了吗？", "cancel"],
  ]) {
    fixtureOverride = {
      taskId: created.taskId,
      expectedRevision: "1",
      operation,
      instruction: text,
      timeExpression: "9:30",
      instant: "2026-10-12T01:30:00Z",
      localDateTime: "2026-10-12T09:30:00",
    };
    const input = (
      await call("/v1/inputs", "POST", {
        text,
        timeZone: "Asia/Shanghai",
        conversationId: first.conversationId,
        taskId: created.taskId,
      })
    ).body;
    expect((await settle(input.runId)).status, text).toBe(
      "needs_clarification",
    );
    expect((await call("/v1/tasks/" + created.taskId)).body, text).toEqual(
      original,
    );
  }
  for (const text of [
    "已完成",
    "already completed",
    "Can you complete this task?",
  ]) {
    const manual = draft();
    const task = (await call("/v1/tasks", "POST", manual)).body;
    fixtureOverride = {
      taskId: task.id,
      expectedRevision: "1",
      operation: "complete",
      instruction: text,
    };
    const input = (
      await call("/v1/inputs", "POST", {
        text,
        timeZone: "Asia/Shanghai",
        taskId: task.id,
      })
    ).body;
    expect((await settle(input.runId)).status).toBe("succeeded");
    expect((await call("/v1/tasks/" + task.id)).body.status).toBe("completed");
  }
  fixtureMode = "valid";
  fixtureOverride = undefined;
}, 50000);

test("an explicit deadline cannot disappear and Friday resolves independently from tomorrow's reminder", async () => {
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  const text = "明天上午9点提醒我提交材料，周五截止";
  fixtureOverride = { instruction: text };
  const omitted = (
    await call("/v1/inputs", "POST", { text, timeZone: "Asia/Shanghai" })
  ).body;
  const unresolved = await settle(omitted.runId);
  expect(unresolved.status).toBe("needs_clarification");
  expect(unresolved.taskId).toBeUndefined();
  for (const [instruction, expression] of [
    [text, "周五截止"],
    ["明天九点提醒提交材料，周五截止", "周五截止"],
    ["明天上午9点提醒我提交材料，截止2026-10-16", "截止2026-10-16"],
  ]) {
    fixtureOverride = {
      instruction,
      deadlineDate: "2026-10-16",
      deadlineExpression: expression,
      timeExpression: instruction.includes("明天九点")
        ? "明天九点"
        : "明天上午9点",
    };
    const accepted = (
      await call("/v1/inputs", "POST", {
        text: instruction,
        timeZone: "Asia/Shanghai",
      })
    ).body;
    const run = await settle(accepted.runId);
    expect(run.status).toBe("succeeded");
    expect((await call("/v1/tasks/" + run.taskId)).body).toMatchObject({
      deadline: { kind: "date", date: "2026-10-16", timeZone: "Asia/Shanghai" },
      reminder: {
        instant: "2026-10-12T01:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
    });
  }
  fixtureOverride = {
    instruction: "明天上午9点提醒我提交材料，月底截止",
    deadlineDate: "2026-10-16",
    deadlineExpression: "月底截止",
  };
  const vague = (
    await call("/v1/inputs", "POST", {
      text: fixtureOverride.instruction,
      timeZone: "Asia/Shanghai",
    })
  ).body;
  expect((await settle(vague.runId)).status).toBe("needs_clarification");
  fixtureOverride = undefined;
}, 20000);

test("a retried input can be cancelled again with a new operation and rejects both late proposals", async () => {
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  fixtureOverride = undefined;
  const count = (await call("/v1/tasks")).body.tasks.length;
  let release!: () => void;
  fixtureWait = new Promise<void>((r) => {
    release = r;
  });
  const first = (
    await call("/v1/inputs", "POST", {
      text: "明天上午9点提醒我提交材料",
      timeZone: "Asia/Shanghai",
    })
  ).body;
  let requests = payloads.length;
  for (
    let n = 0;
    n < 100 && (await call("/v1/runs/" + first.runId)).body.requests !== 1;
    n++
  )
    await new Promise((r) => setTimeout(r, 30));
  const firstKey = randomUUID();
  expect(
    (await call("/v1/runs/" + first.runId + "/cancel", "POST", {}, firstKey))
      .body.status,
  ).toBe("cancelled");
  fixtureWait = undefined;
  release();
  requests = payloads.length;
  fixtureWait = new Promise<void>((r) => {
    release = r;
  });
  const upstream = base;
  let acknowledgeRetry!: () => void;
  const delayedAcknowledgement = new Promise<void>((r) => {
    acknowledgeRetry = r;
  });
  const transport = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const response = await fetch(upstream + req.url, {
      method: req.method,
      headers: {
        authorization: req.headers.authorization!,
        "idempotency-key": req.headers["idempotency-key"] as string,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
    const payload = await response.text();
    if (req.url?.endsWith("/retry")) await delayedAcknowledgement;
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(payload);
  });
  await new Promise<void>((r) => transport.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (transport.address() as { port: number }).port;
  const pendingRetry = call("/v1/runs/" + first.runId + "/retry", "POST", {});
  // The server commits and starts work while the transport withholds its acknowledgement.
  try {
    for (let n = 0; n < 100 && payloads.length <= requests; n++)
      await new Promise((r) => setTimeout(r, 30));
    expect(payloads.length).toBeGreaterThan(requests);
    const replay = await call(
      "/v1/runs/" + first.runId + "/cancel",
      "POST",
      {},
      firstKey,
    );
    expect(replay.body.status).toBe("running");
    expect((await call("/v1/runs/" + first.runId)).body.status).toBe("running");
    acknowledgeRetry();
    const retried = await pendingRetry;
    expect(retried.body.runId).toBe(first.runId);
    const secondKey = randomUUID();
    expect(
      (await call("/v1/runs/" + first.runId + "/cancel", "POST", {}, secondKey))
        .body.status,
    ).toBe("cancelled");
  } finally {
    acknowledgeRetry();
    await pendingRetry;
    base = upstream;
    await new Promise<void>((r) => transport.close(() => r()));
    fixtureWait = undefined;
    release();
  }
  await new Promise((r) => setTimeout(r, 150));
  expect((await call("/v1/runs/" + first.runId)).body.status).toBe("cancelled");
  expect((await call("/v1/tasks")).body.tasks).toHaveLength(count);
}, 15000);

test("queued relative dates remain anchored to input receipt across local midnight and past reminders cannot save", async () => {
  await worker?.stop();
  worker = undefined;
  currentInstant = "2026-10-11T15:59:00Z"; // Sunday 23:59 Shanghai.
  const session = (await call("/v1/session/renew", "POST", { refreshToken }))
    .body;
  token = session.accessToken;
  refreshToken = session.refreshToken;
  fixtureMode = "valid";
  fixtureOverride = {
    instruction: "明天上午9点提醒我提交材料，周五截止",
    deadlineDate: "2026-10-16",
    deadlineExpression: "周五截止",
  };
  const first = (
    await call("/v1/inputs", "POST", {
      text: fixtureOverride.instruction,
      timeZone: "Asia/Shanghai",
    })
  ).body;
  currentInstant = "2026-10-11T16:01:00Z"; // Monday 00:01, only two minutes later.
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    },
  });
  const run = await settle(first.runId);
  expect(run.status).toBe("succeeded");
  expect((await call("/v1/tasks/" + run.taskId)).body).toMatchObject({
    deadline: { date: "2026-10-16" },
    reminder: { instant: "2026-10-12T01:00:00.000Z" },
  });
  await worker.stop();
  worker = undefined;
  currentInstant = "2026-10-11T16:02:00Z";
  fixtureOverride = {
    instruction: "今天00:03提醒我提交材料",
    timeExpression: "今天00:03",
    instant: "2026-10-11T16:03:00Z",
    localDateTime: "2026-10-12T00:03:00",
  };
  const late = (
    await call("/v1/inputs", "POST", {
      text: fixtureOverride.instruction,
      timeZone: "Asia/Shanghai",
    })
  ).body;
  currentInstant = "2026-10-11T16:04:00Z";
  worker = await startAgentWorker({
    ...config,
    model: {
      model: "claude-sonnet-5-5",
      apiKey: "external-fixture-key",
      baseUrl:
        "http://127.0.0.1:" + (provider.address() as { port: number }).port,
    },
  });
  expect((await settle(late.runId)).status).toBe("needs_clarification");
  fixtureOverride = undefined;
}, 15000);

test("conditional creation proposals clarify while explicit reminders and words containing if stay authorized", async () => {
  currentInstant = "2026-10-11T12:00:00Z";
  if (!worker)
    worker = await startAgentWorker({
      ...config,
      model: {
        model: "claude-sonnet-5-5",
        apiKey: "external-fixture-key",
        baseUrl:
          "http://127.0.0.1:" + (provider.address() as { port: number }).port,
      },
    });
  fixtureMode = "valid";
  const before = (await call("/v1/tasks")).body.tasks;
  for (const text of [
    "If it rains, remind me tomorrow at 09:00 to take an umbrella",
    "Unless it rains, remind me tomorrow at 09:00 to take an umbrella",
    "When it rains, remind me tomorrow at 09:00 to take an umbrella",
    "假如下雨，明天上午9点提醒我带伞",
    "若下雨，明天上午9点提醒我带伞",
    "一旦下雨，明天上午9点提醒我带伞",
  ]) {
    fixtureOverride = {
      instruction: text,
      timeExpression: text.includes("tomorrow")
        ? "tomorrow at 09:00"
        : "明天上午9点",
      title: "带伞",
    };
    const accepted = (
      await call("/v1/inputs", "POST", { text, timeZone: "Asia/Shanghai" })
    ).body;
    expect((await settle(accepted.runId)).status, text).toBe(
      "needs_clarification",
    );
    expect((await call("/v1/tasks")).body.tasks, text).toEqual(before);
    const history = (await call("/v1/conversations/" + accepted.conversationId))
      .body;
    expect(history.messages[0].text).toBe(text);
  }
  for (const text of [
    "Remind me tomorrow at 09:00 to buy a gift",
    "明天上午9点提醒我带伞",
  ]) {
    fixtureOverride = {
      instruction: text,
      timeExpression: text.includes("tomorrow")
        ? "tomorrow at 09:00"
        : "明天上午9点",
      title: text.includes("gift") ? "buy a gift" : "带伞",
    };
    const accepted = (
      await call("/v1/inputs", "POST", { text, timeZone: "Asia/Shanghai" })
    ).body;
    const run = await settle(accepted.runId);
    expect(run.status, text).toBe("succeeded");
    expect((await call("/v1/tasks/" + run.taskId)).body.sources[0].text).toBe(
      text,
    );
  }
  fixtureOverride = undefined;
}, 30000);

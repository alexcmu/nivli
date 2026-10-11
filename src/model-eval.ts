import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { readModelConfig } from "./model-config.js";
import { createApp } from "./app.js";
import { migrate } from "./database.js";
import { startAgentWorker } from "./agent-worker.js";
type Step = {
  text: string;
  expected: "create" | "change" | "clarify" | "prohibited";
  expectedInstant?: string;
  expectedStatus?: string;
  replyToPrevious?: boolean;
  selectPreviousTask?: boolean;
};
type Case = {
  id: string;
  language: string;
  timeZone: string;
  now: string;
  messages: Step[];
  reason: string;
  forbiddenActions: string[];
};
const cases = JSON.parse(
  await readFile("evals/conversation-cases.json", "utf8"),
) as Case[];
const output =
  process.env.NIVLI_EVAL_REPORT ?? "/tmp/nivli-conversation-evaluation.json";
const budget = Number(process.env.MODEL_DAILY_BUDGET_USD ?? "1");
if (!Number.isFinite(budget) || budget <= 0 || budget > 10)
  throw new Error(
    "Evaluation budget must be greater than zero and at most USD 10",
  );
const report: {
  status: string;
  model: string;
  piVersion: string;
  budgetUsd: number;
  invoiceAvailable: boolean;
  cases: number;
  results: unknown[];
} = {
  status: "not_run",
  model: "claude-sonnet-5-5",
  piVersion: "1.1.0",
  budgetUsd: budget,
  invoiceAvailable: false,
  cases: cases.length,
  results: [],
};
const model = await readModelConfig();
if (process.env.NIVLI_REAL_MODEL_EVAL !== "1" || !model) {
  await writeFile(
    output,
    JSON.stringify(
      {
        ...report,
        reason:
          "Explicit opt-in and server-only model configuration are required; labeled cases are not model results.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Model evaluation not run; report written.");
} else {
  const root =
    process.env.DATABASE_URL ??
    "postgres://nivli:nivli@127.0.0.1:55432/nivli_test";
  const maintenance = new pg.Pool({ connectionString: root }),
    name = "model_eval_" + randomUUID().replaceAll("-", ""),
    url = new URL(root);
  url.pathname = "/" + name;
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    worker: Awaited<ReturnType<typeof startAgentWorker>> | undefined;
  try {
    await maintenance.query("CREATE DATABASE " + name);
    await migrate(url.toString());
    let clock = new Date(cases[0]!.now);
    const admin = randomBytes(32).toString("hex");
    const config = {
      databaseUrl: url.toString(),
      adminSecret: admin,
      publicUrl: "https://isolated-evaluation.invalid",
      environmentName: "Isolated model evaluation",
      pushMode: "disabled" as const,
      modelDataDestination: model.baseUrl,
      clock: () => clock,
      model: { ...model, dailyBudgetUsd: budget },
    };
    app = await createApp(config);
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    worker = await startAgentWorker(config);
    let token = "";
    async function call(
      path: string,
      method = "GET",
      body?: unknown,
      authorization = token,
    ) {
      const r = await fetch(base + path, {
        method,
        headers: {
          authorization: "Bearer " + authorization,
          "idempotency-key": randomUUID(),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = (await r.json()) as any;
      if (!r.ok) throw new Error("Public evaluation API failed: " + r.status);
      return value;
    }
    const pairing = await call("/v1/admin/pairings", "POST", {}, admin);
    token = (
      await call("/v1/pairings/claim", "POST", {
        code: pairing.code,
        deviceName: "Isolated evaluation",
      })
    ).accessToken;
    report.status = "completed";
    for (const sample of cases) {
      clock = new Date(sample.now);
      let conversationId: string | undefined,
        previousInputId: string | undefined,
        previousTaskId: string | undefined;
      const steps = [];
      for (const step of sample.messages) {
        const before = (await call("/v1/tasks")).tasks;
        const signature = (tasks: any[]) =>
          JSON.stringify(tasks.map((t) => [t.id, t.revision, t.status]).sort());
        const q = await call("/v1/inputs", "POST", {
          text: step.text,
          timeZone: sample.timeZone,
          ...(conversationId ? { conversationId } : {}),
          ...(step.replyToPrevious ? { replyToInputId: previousInputId } : {}),
          ...(step.selectPreviousTask ? { taskId: previousTaskId } : {}),
        });
        conversationId = q.conversationId;
        let run: any;
        for (let n = 0; n < 140; n++) {
          run = await call("/v1/runs/" + q.runId);
          if (!["queued", "running"].includes(run.status)) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const after = (await call("/v1/tasks")).tasks,
          task = run.taskId ? await call("/v1/tasks/" + run.taskId) : undefined;
        let passed = false;
        if (step.expected === "create")
          passed =
            run.status === "succeeded" &&
            !!task &&
            after.length === before.length + 1;
        else if (step.expected === "change")
          passed =
            run.status === "succeeded" &&
            !!task &&
            after.length === before.length &&
            task.revision ===
              (before.find((t: any) => t.id === task.id)?.revision ?? 0) + 1;
        else
          passed =
            run.status === "needs_clarification" &&
            signature(after) === signature(before);
        if (step.expectedInstant)
          passed =
            passed &&
            task?.reminder?.instant ===
              new Date(step.expectedInstant).toISOString();
        if (step.expectedStatus)
          passed = passed && task?.status === step.expectedStatus;
        steps.push({
          expected: step.expected,
          actual: run.status,
          passed,
          requests: run.requests,
          toolCalls: run.toolCalls,
          errorCode: run.errorCode ?? null,
          cost: run.cost ?? null,
        });
        previousInputId = q.inputId;
        previousTaskId = run.taskId ?? previousTaskId;
      }
      report.results.push({
        id: sample.id,
        language: sample.language,
        passed: steps.every((s) => s.passed),
        steps,
      });
    }
  } catch {
    report.status = "failed";
    throw new Error(
      "Evaluation interrupted; inspect partial report, which is not a completed evaluation.",
    );
  } finally {
    await worker?.stop();
    await app?.close();
    await maintenance.query(
      "DROP DATABASE IF EXISTS " + name + " WITH (FORCE)",
    );
    await maintenance.end();
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    "Real model evaluation report written; inspect individual labeled outcomes.",
  );
}

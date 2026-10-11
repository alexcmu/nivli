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
  expectedDeadline?: string;
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
const allCases = JSON.parse(
  await readFile("evals/conversation-cases.json", "utf8"),
) as Case[];
const selectedIds = process.env.NIVLI_EVAL_CASE_IDS?.split(",");
const cases = selectedIds
  ? allCases.filter((sample) => selectedIds.includes(sample.id))
  : allCases;
if (selectedIds?.some((id) => !allCases.some((sample) => sample.id === id)))
  throw new Error("Unknown evaluation case ID");
const output =
  process.env.NIVLI_EVAL_REPORT ?? "/tmp/nivli-conversation-evaluation.json";
const budget = Number(process.env.MODEL_DAILY_BUDGET_USD ?? "1");
if (!Number.isFinite(budget) || budget <= 0 || budget > 2)
  throw new Error(
    "Evaluation budget must be greater than zero and at most USD 2",
  );
const report: {
  status: string;
  model: string;
  piVersion: string;
  budgetUsd: number;
  invoiceAvailable: boolean;
  cases: number;
  usageUsd: number;
  unknownRequests: number;
  requests: number;
  results: any[];
  cleanupFailures: string[];
} = {
  status: "not_run",
  model: "claude-sonnet-5-5",
  piVersion: "1.1.0",
  budgetUsd: budget,
  invoiceAvailable: false,
  cases: cases.length,
  usageUsd: 0,
  unknownRequests: 0,
  requests: 0,
  results: [],
  cleanupFailures: [],
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
  const maintenance = new pg.Pool({ connectionString: root });
  let committedUsd = 0;
  report.status = "running";
  let failure: Error | undefined;
  try {
    for (const sample of cases) {
      if (budget - committedUsd < 0.141312) {
        if (report.status !== "partial_failure")
          report.status = "budget_exhausted";
        report.results.push({
          id: sample.id,
          status: "unevaluated",
          reason: "budget_exhausted",
        });
        continue;
      }
      const name = "model_eval_" + randomUUID().replaceAll("-", ""),
        url = new URL(root);
      url.pathname = "/" + name;
      const steps: any[] = [];
      let account: (() => Promise<any>) | undefined;
      let app: Awaited<ReturnType<typeof createApp>> | undefined,
        worker: Awaited<ReturnType<typeof startAgentWorker>> | undefined;
      try {
        await maintenance.query("CREATE DATABASE " + name);
        await migrate(url.toString());
        const clock = new Date(sample.now);
        const admin = randomBytes(32).toString("hex");
        const config = {
          databaseUrl: url.toString(),
          adminSecret: admin,
          publicUrl: "https://isolated-evaluation.invalid",
          environmentName: "Isolated model evaluation",
          pushMode: "disabled" as const,
          modelDataDestination: model.baseUrl,
          clock: () => clock,
          model: { ...model, dailyBudgetUsd: budget - committedUsd },
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
          if (!r.ok)
            throw new Error("Public evaluation API failed: " + r.status);
          return value;
        }
        account = () => call("/v1/admin/model/budget", "GET", undefined, admin);
        const pairing = await call("/v1/admin/pairings", "POST", {}, admin);
        token = (
          await call("/v1/pairings/claim", "POST", {
            code: pairing.code,
            deviceName: "Isolated evaluation",
          })
        ).accessToken;
        async function allTasks() {
          const tasks = [];
          let cursor: string | undefined;
          do {
            const page = await call(
              "/v1/tasks?status=all&limit=100" +
                (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            );
            tasks.push(...page.tasks);
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          return tasks;
        }
        let conversationId: string | undefined,
          previousInputId: string | undefined,
          previousTaskId: string | undefined;
        for (const step of sample.messages) {
          const before = await allTasks();
          const signature = (tasks: any[]) =>
            JSON.stringify(
              tasks.map((t) => [t.id, t.revision, t.status]).sort(),
            );
          const q = await call("/v1/inputs", "POST", {
            text: step.text,
            timeZone: sample.timeZone,
            ...(conversationId ? { conversationId } : {}),
            ...(step.replyToPrevious
              ? { replyToInputId: previousInputId }
              : {}),
            ...(step.selectPreviousTask ? { taskId: previousTaskId } : {}),
          });
          conversationId = q.conversationId;
          let run: any;
          for (let n = 0; n < 140; n++) {
            run = await call("/v1/runs/" + q.runId);
            if (!["queued", "running"].includes(run.status)) break;
            await new Promise((r) => setTimeout(r, 500));
          }
          const after = await allTasks(),
            task = run.taskId
              ? await call("/v1/tasks/" + run.taskId)
              : undefined;
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
          if (step.expectedDeadline)
            passed = passed && task?.deadline?.date === step.expectedDeadline;
          if (step.expectedStatus)
            passed = passed && task?.status === step.expectedStatus;
          if (
            run.errorCode === "MODEL_BUDGET_EXHAUSTED" &&
            report.status !== "partial_failure"
          )
            report.status = "budget_exhausted";
          steps.push({
            evaluated: run.errorCode !== "MODEL_BUDGET_EXHAUSTED",

            expected: step.expected,
            actualInstant: task?.reminder?.instant ?? null,
            actualDeadline: task?.deadline?.date ?? null,
            actualTaskStatus: task?.status ?? null,
            actual: run.status,
            publicMessage: run.message,
            passed,
            requests: run.requests,
            toolCalls: run.toolCalls,
            errorCode: run.errorCode ?? null,
            cost: run.cost ?? null,
          });
          previousInputId = q.inputId;
          previousTaskId = run.taskId ?? previousTaskId;
        }
        const accounting = await call(
          "/v1/admin/model/budget",
          "GET",
          undefined,
          admin,
        );
        report.usageUsd += accounting.usageUsd;
        report.unknownRequests += accounting.unknownRequests;
        report.requests += accounting.requests;
        committedUsd += budget - committedUsd - accounting.remainingUsd;
        report.results.push({
          id: sample.id,
          language: sample.language,
          status: steps.some((s) => !s.evaluated) ? "unevaluated" : "evaluated",
          passed: steps.every((s) => s.evaluated)
            ? steps.every((s) => s.passed)
            : null,
          steps,
        });
      } catch {
        report.status = "partial_failure";
        report.results.push({
          id: sample.id,
          status: "unevaluated",
          reason: "evaluation_api_failure",
          steps,
        });
        try {
          const accounting = await account?.();
          if (!accounting) throw new Error("No accounting");
          report.usageUsd += accounting.usageUsd;
          report.unknownRequests += accounting.unknownRequests;
          report.requests += accounting.requests;
          committedUsd += budget - committedUsd - accounting.remainingUsd;
        } catch {
          // If usage cannot be observed, further paid requests are unsafe.
          committedUsd = budget;
        }
      } finally {
        const stopped = await Promise.allSettled([
          (async () => {
            await worker?.stop();
          })(),
          (async () => {
            await app?.close();
          })(),
        ]);
        for (const [index, result] of stopped.entries())
          if (result.status === "rejected")
            report.cleanupFailures.push(
              index === 0 ? "worker_stop" : "app_close",
            );
        try {
          for (let attempt = 0; attempt < 50; attempt++) {
            const active = await maintenance.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=$1",
              [name],
            );
            if (active.rowCount === 0) {
              await maintenance.query('DROP DATABASE IF EXISTS "' + name + '"');
              break;
            }
            if (attempt === 49)
              throw new Error(
                "Evaluation database did not drain after shutdown",
              );
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } catch {
          report.cleanupFailures.push("database_drain_or_drop");
        }
        if (report.cleanupFailures.length) {
          report.status = "partial_failure";
          failure = new Error(
            "Evaluation cleanup failed; inspect the persisted partial report.",
          );
        }
        await writeFile(output, JSON.stringify(report, null, 2) + "\n");
      }
      if (failure) throw failure;
    }
  } catch {
    report.status = "partial_failure";
    failure ??= new Error(
      "Evaluation interrupted; inspect the persisted partial report.",
    );
  } finally {
    try {
      await maintenance.end();
    } catch {
      report.status = "partial_failure";
      report.cleanupFailures.push("maintenance_close");
      failure ??= new Error(
        "Evaluation maintenance cleanup failed; inspect the persisted partial report.",
      );
    } finally {
      if (report.status === "running") report.status = "completed";
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
  if (failure) throw failure;
  console.log(
    "Real model evaluation report written; inspect individual labeled outcomes.",
  );
}

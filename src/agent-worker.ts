import { reserveRequest, settleRequest } from "./agent-budget.js";
import {
  commitConversationResult,
  loadConversationContext,
} from "./conversation.js";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { interpret, type ModelConfig, type AgentInput } from "./pi-adapter.js";
import { validateProposal } from "./agent-validation.js";
import { createTaskInTransaction } from "./task-create.js";
export async function startAgentWorker(config: {
  databaseUrl: string;
  model?: ModelConfig;
  clock?: () => Date;
}) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl }),
    boss = new PgBoss({ connectionString: config.databaseUrl, migrate: false }),
    shutdown = new AbortController();
  let scanning = false;
  boss.on("error", () => console.error("Agent queue unavailable"));
  await boss.start();
  await boss.createQueue("agent");
  const now = () => config.clock?.() ?? new Date();
  async function processRun(id: string) {
    const claimed = (
      await pool.query(
        "UPDATE agent_run SET status='running',started_at=$2,deadline_at=$3,lease_expires_at=clock_timestamp()+interval '2 seconds',attempt=attempt+1 WHERE id=$1 AND status='queued' AND NOT EXISTS(SELECT 1 FROM input_event mine JOIN input_event earlier ON earlier.conversation_id=mine.conversation_id AND earlier.conversation_revision<mine.conversation_revision JOIN agent_run prior ON prior.input_id=earlier.id WHERE mine.id=agent_run.input_id AND prior.status IN('queued','running')) RETURNING *",
        [
          id,
          now(),
          new Date(
            now().getTime() + Math.min(config.model?.timeoutMs ?? 60000, 60000),
          ),
        ],
      )
    ).rows[0];
    if (!claimed) return;
    const input = (
      await pool.query("SELECT * FROM input_event WHERE id=$1", [
        claimed.input_id,
      ])
    ).rows[0];
    const runAbort = new AbortController();
    const monitor = setInterval(() => {
      void pool
        .query(
          "UPDATE agent_run SET lease_expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1 AND status='running' AND attempt=$2 RETURNING status,attempt,deadline_at",
          [id, claimed.attempt],
        )
        .then(({ rows }) => {
          const r = rows[0];
          if (
            !r ||
            r.status !== "running" ||
            r.attempt !== claimed.attempt ||
            new Date(r.deadline_at).getTime() <= now().getTime()
          )
            runAbort.abort();
        })
        .catch(() => runAbort.abort());
    }, 50);
    const hard = setTimeout(
      () => runAbort.abort(),
      Math.min(config.model?.timeoutMs ?? 60000, 60000),
    );
    const owned: AgentInput = {
      ownerId: input.owner_id,
      inputId: input.id,
      text: input.text,
      timeZone: input.time_zone,
      now: now().toISOString(),
      signal: AbortSignal.any([shutdown.signal, runAbort.signal]),
      context: await loadConversationContext(pool, input),
      assertActive: async () => {
        owned.signal.throwIfAborted();
        const r = (
          await pool.query(
            "SELECT id FROM agent_run WHERE id=$1 AND status='running' AND attempt=$2 AND deadline_at>$3",
            [id, claimed.attempt, now()],
          )
        ).rowCount;
        if (!r) throw new Error("Run inactive");
      },
      beforeRequest: async (_context, maxTokens) =>
        reserveRequest(
          pool,
          id,
          claimed.attempt,
          config.model?.dailyBudgetUsd ?? 1,
          maxTokens,
          now(),
        ),
      afterRequest: async (reservation, usage) =>
        settleRequest(pool, reservation, usage),
    };
    const permitted = (
      await pool.query(
        "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND s.device_id=$3 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.refresh_expires_at>$4",
        [input.session_id, input.owner_id, input.device_id, now()],
      )
    ).rowCount;
    const result =
      config.model && permitted
        ? await interpret(config.model, owned)
        : {
            output: {
              kind: "failed" as const,
              message: "尚未配置 AI 模型。原话已保留，可手动设置。",
            },
            requests: 0,
            toolCalls: 0,
          };
    clearInterval(monitor);
    clearTimeout(hard);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
        input.owner_id,
      ]);
      const active = (
        await c.query(
          "SELECT * FROM agent_run WHERE id=$1 AND status='running' AND attempt=$2 FOR UPDATE",
          [id, claimed.attempt],
        )
      ).rows[0];
      if (!active || shutdown.signal.aborted) {
        await c.query("ROLLBACK");
        return;
      }
      if (
        owned.signal.aborted ||
        new Date(active.deadline_at).getTime() <= now().getTime()
      ) {
        await c.query(
          "UPDATE agent_run SET status='timed_out',error_code='MODEL_TIMEOUT',message='处理已超时，原话已保留。重试可能再次产生模型费用。',finished_at=$2 WHERE id=$1",
          [id, now()],
        );
        await c.query("COMMIT");
        return;
      }
      const auth = (
        await c.query(
          "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND s.device_id=$3 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.refresh_expires_at>$4 FOR SHARE OF s,d",
          [input.session_id, input.owner_id, input.device_id, now()],
        )
      ).rowCount;
      let status = "failed",
        message = "身份已失效，请重新连接。",
        taskId: string | null = null;
      if (active.error_code === "MODEL_BUDGET_EXHAUSTED") {
        message =
          "今日 AI 额度已用完（UTC 零点重置）。原话已保留，可手动设置或稍后重试。";
      } else if (auth) {
        if (result.output.kind === "proposal") {
          if (validateProposal(result.output.proposal, owned)) {
            const p = result.output.proposal;
            taskId = input.id;
            await createTaskInTransaction(
              c,
              { ownerId: input.owner_id, deviceId: input.device_id },
              {
                taskId: input.id,
                commandId: input.id,
                localDeviceId: input.device_id,
                title: p.title,
                background: "",
                reminder: { instant: p.instant, timeZone: input.time_zone },
                ...(p.deadlineDate
                  ? {
                      deadline: {
                        kind: "date" as const,
                        date: p.deadlineDate,
                        timeZone: input.time_zone,
                      },
                    }
                  : {}),
              },
              now(),
              { kind: "instruction", text: input.text },
            );
            status = "succeeded";
            message = "事项已保存，请查看手机的实际提醒安排状态。";
          } else {
            status = "needs_clarification";
            message =
              "请补充明确的日期、时间和要提醒的事项；当前交代尚未创建事项。";
          }
        } else {
          status =
            result.output.kind === "failed" ? "failed" : "needs_clarification";
          message =
            result.output.kind === "reply"
              ? "AI 未创建事项。请明确日期和时间，或手动设置。"
              : result.output.message.slice(0, 1000);
        }
      }
      await c.query(
        "UPDATE agent_run SET status=$2,message=$3,task_id=$4,requests=$5,tool_calls=$6,finished_at=$7 WHERE id=$1",
        [id, status, message, taskId, result.requests, result.toolCalls, now()],
      );
      await commitConversationResult(c, input);
      await c.query("COMMIT");
    } catch {
      await c.query("ROLLBACK");
      await pool.query(
        "UPDATE agent_run SET status='failed',message='处理失败，原话已保留。',finished_at=$2 WHERE id=$1 AND status='running' AND attempt=$3",
        [id, now(), claimed.attempt],
      );
    } finally {
      c.release();
    }
  }
  await boss.work<{ runId: string }>(
    "agent",
    { pollingIntervalSeconds: 0.5, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) await processRun(job.data.runId);
    },
  );
  async function scan() {
    if (scanning || shutdown.signal.aborted) return;
    scanning = true;
    try {
      // InputEvent and queued run are the durable outbox. Crash between commit and enqueue is recovered here.
      await pool.query(
        "UPDATE agent_run SET status='queued',message='上次处理已中断，正在恢复；未确认的请求可能再次产生模型费用。',started_at=NULL,deadline_at=NULL WHERE status='running' AND (lease_expires_at<clock_timestamp() OR (lease_expires_at IS NULL AND started_at<$1))",
        [new Date(now().getTime() - 65000)],
      );
      const rows = (
        await pool.query(
          "SELECT id,attempt FROM agent_run WHERE status='queued' ORDER BY id LIMIT 100",
        )
      ).rows;
      for (const row of rows)
        await boss.send(
          "agent",
          { runId: row.id },
          {
            singletonKey: row.id + ":" + row.attempt,
            retryLimit: 0,
            expireInSeconds: 65,
          },
        );
    } catch {
      console.error("Agent dispatch unavailable");
    } finally {
      scanning = false;
    }
  }
  await scan();
  const interval = setInterval(() => void scan(), 500);
  return {
    stop: async () => {
      clearInterval(interval);
      shutdown.abort();
      await boss.stop({ graceful: true });
      await pool.end();
    },
  };
}

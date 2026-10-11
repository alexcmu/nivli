import { randomUUID } from "node:crypto";
import type pg from "pg";
export class AgentBudgetError extends Error {
  readonly code = "MODEL_BUDGET_EXHAUSTED";
}
// Context is capped at 16,000 UTF-16 code units by the adapter. Reserve a full
// 65,536 input tokens including provider framing/tools; never tokenize by words.
export const INPUT_TOKEN_RESERVATION = 65536;
export async function reserveRequest(
  pool: pg.Pool,
  runId: string | null,
  attempt: number,
  dailyLimit: number,
  maxTokens: number,
  now: Date,
): Promise<string> {
  const c = await pool.connect(),
    day = now.toISOString().slice(0, 10),
    id = randomUUID();
  const reserved = (INPUT_TOKEN_RESERVATION * 2 + maxTokens * 10) / 1_000_000;
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "model-budget:" + day,
    ]);
    const active = runId
      ? (
          await c.query(
            "SELECT id FROM agent_run WHERE id=$1 AND attempt=$2 AND status='running' AND deadline_at>$3 FOR UPDATE",
            [runId, attempt, now],
          )
        ).rowCount
      : true;
    if (runId && !active) throw new Error("Run inactive");
    const spent = Number(
      (
        await c.query(
          "SELECT COALESCE(sum(CASE WHEN settled THEN GREATEST(usage_usd,0) ELSE reserved_usd END),0) AS spent FROM model_request WHERE budget_day=$1",
          [day],
        )
      ).rows[0].spent,
    );
    if (spent + reserved > dailyLimit) {
      await c.query(
        "UPDATE agent_run SET error_code='MODEL_BUDGET_EXHAUSTED' WHERE id=$1",
        [runId],
      );
      await c.query("COMMIT");
      throw new AgentBudgetError("Daily model budget exhausted");
    }
    await c.query(
      "INSERT INTO model_request(id,run_id,attempt,budget_day,reserved_usd,max_output_tokens,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, runId, attempt, day, reserved, maxTokens, now],
    );
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function settleRequest(
  pool: pg.Pool,
  id: string,
  usage: {
    input: number;
    output: number;
    totalTokens: number;
    costTotal: number;
  },
) {
  if (
    !Number.isFinite(usage.input) ||
    !Number.isFinite(usage.output) ||
    usage.input < 0 ||
    usage.output < 0
  )
    return;
  // Zero usage on transport failures is unknown, not proof that no fee occurred.
  if (usage.totalTokens <= 0) return;
  const cost = Math.max(
    (usage.input * 2 + usage.output * 10) / 1_000_000,
    usage.costTotal || 0,
  );
  await pool.query(
    "UPDATE model_request SET settled=true,input_tokens=$2,output_tokens=$3,usage_usd=$4 WHERE id=$1 AND settled=false",
    [id, usage.input, usage.output, cost],
  );
}
export async function budgetReport(pool: pg.Pool, now: Date, limit: number) {
  const day = now.toISOString().slice(0, 10),
    r = (
      await pool.query(
        "SELECT count(*)::int requests,COALESCE(sum(reserved_usd),0)::float reserved,COALESCE(sum(usage_usd) FILTER(WHERE settled),0)::float usage,COALESCE(sum(CASE WHEN settled THEN usage_usd ELSE reserved_usd END),0)::float committed, count(*) FILTER(WHERE NOT settled)::int unknown FROM model_request WHERE budget_day=$1",
        [day],
      )
    ).rows[0];
  return {
    day,
    timeZone: "UTC" as const,
    limitUsd: limit,
    requests: r.requests,
    reservedUsd: r.reserved,
    usageUsd: r.usage,
    unknownRequests: r.unknown,
    remainingUsd: Math.max(0, limit - r.committed),
    invoiceAvailable: false as const,
  };
}

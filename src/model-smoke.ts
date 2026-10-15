import { INPUT_TOKEN_RESERVATION } from "./agent-budget.js";
import { readModelConfig } from "./model-config.js";
import { interpret } from "./pi-adapter.js";
import { validateProposal } from "./agent-validation.js";
import { randomUUID } from "node:crypto";
if (process.env.HAIJI_REAL_MODEL_SMOKE !== "1")
  throw new Error("Explicit HAIJI_REAL_MODEL_SMOKE=1 is required");
const model = await readModelConfig();
if (!model) throw new Error("Configure a server-only model API key first");
const smokeBudget = Number(process.env.MODEL_SMOKE_BUDGET_USD ?? 0.5);
if (!Number.isFinite(smokeBudget) || smokeBudget <= 0 || smokeBudget > 1)
  throw new Error("Isolated smoke budget must be >0 and <=1 USD");
let committed = 0,
  usageUsd = 0;
const reservations = new Map<string, number>();
const input = {
  ownerId: randomUUID(),
  inputId: randomUUID(),
  text: "明天上午9点提醒我检查测试事项",
  timeZone: "Asia/Shanghai",
  now: new Date().toISOString(),
  signal: AbortSignal.timeout(60000),
  beforeRequest: async (_context: unknown, maxTokens: number) => {
    const estimate = (INPUT_TOKEN_RESERVATION * 2 + maxTokens * 10) / 1_000_000;
    if (committed + estimate > smokeBudget)
      throw new Error("Isolated smoke budget exhausted");
    const id = randomUUID();
    committed += estimate;
    reservations.set(id, estimate);
    return id;
  },
  afterRequest: async (
    id: string,
    usage: {
      input: number;
      output: number;
      totalTokens: number;
      costTotal: number;
    },
  ) => {
    if (usage.totalTokens <= 0) return;
    const cost = Math.max(
      (usage.input * 2 + usage.output * 10) / 1_000_000,
      usage.costTotal || 0,
    );
    committed += cost - (reservations.get(id) ?? 0);
    usageUsd += cost;
  },
};
const result = await interpret(model, input);
if (
  result.output.kind !== "proposal" ||
  !validateProposal(result.output.proposal, input) ||
  !Number.isFinite(result.usage.totalTokens) ||
  result.requests > 3 ||
  result.toolCalls > 6
)
  throw new Error(
    "Live model schema/tool contract failed; no business entity was written",
  );
console.log(
  JSON.stringify({
    ok: true,
    provider: "anthropic",
    model: model.model,
    requests: result.requests,
    toolCalls: result.toolCalls,
    usage: result.usage,
    isolatedSmokeBudgetUsd: smokeBudget,
    usageUsd,
    invoiceAvailable: false,
    productionBudgetShared: false,
  }),
);

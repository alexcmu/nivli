import { readModelConfig } from "./model-config.js";
import { interpret } from "./pi-adapter.js";
import { validateProposal } from "./agent-validation.js";
import { randomUUID } from "node:crypto";
if (process.env.NIVLI_REAL_MODEL_SMOKE !== "1")
  throw new Error("Explicit NIVLI_REAL_MODEL_SMOKE=1 is required");
const model = await readModelConfig();
if (!model) throw new Error("Configure a server-only model API key first");
const input = {
  ownerId: randomUUID(),
  inputId: randomUUID(),
  text: "明天上午9点提醒我检查测试事项",
  timeZone: "Asia/Shanghai",
  now: new Date().toISOString(),
  signal: AbortSignal.timeout(60000),
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
  }),
);

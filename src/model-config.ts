import { readFile } from "node:fs/promises";
import type { ModelConfig } from "./pi-adapter.js";
export async function readModelConfig(): Promise<ModelConfig | undefined> {
  const file = process.env.MODEL_API_KEY_FILE,
    key = process.env.ANTHROPIC_API_KEY;
  if (!file && !key) return undefined;
  const apiKey = file ? (await readFile(file, "utf8")).trim() : key!;
  if (!apiKey) throw new Error("Model API key is empty");
  const endpoint = new URL(
    process.env.MODEL_BASE_URL ?? "https://api.anthropic.com",
  );
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      "Model endpoint must use HTTPS without embedded credentials",
    );
  const model = process.env.MODEL_ID ?? "claude-sonnet-5-5";
  if (model !== "claude-sonnet-5-5")
    throw new Error("This release supports configured Claude Sonnet 5.5 only");
  const maxOutputTokens = Number(process.env.MODEL_MAX_OUTPUT_TOKENS ?? 1024),
    dailyBudgetUsd = Number(process.env.MODEL_DAILY_BUDGET_USD ?? 1);
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 128 ||
    maxOutputTokens > 1024 ||
    !Number.isFinite(dailyBudgetUsd) ||
    dailyBudgetUsd < 0 ||
    dailyBudgetUsd > 10000
  )
    throw new Error("Model limits out of range");
  return {
    maxOutputTokens,
    dailyBudgetUsd,
    apiKey,
    baseUrl: endpoint.toString().replace(/\/$/, ""),
    model,
  };
}

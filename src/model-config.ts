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
  return { apiKey, baseUrl: endpoint.toString().replace(/\/$/, ""), model };
}

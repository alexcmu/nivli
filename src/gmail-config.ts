import { readFile } from "node:fs/promises";
import type { GmailConfig } from "./gmail.js";
export async function readGmailConfig(): Promise<GmailConfig | undefined> {
  const file = process.env.GMAIL_CONFIG_FILE;
  if (!file) return undefined;
  const keyFile = process.env.GMAIL_TOKEN_KEY_FILE;
  if (!keyFile)
    throw new Error(
      "GMAIL_TOKEN_KEY_FILE is required with Gmail configuration",
    );
  const value = JSON.parse(await readFile(file, "utf8")) as {
    clientId?: unknown;
    clientSecret?: unknown;
  };
  if (
    typeof value.clientId !== "string" ||
    !value.clientId ||
    typeof value.clientSecret !== "string" ||
    !value.clientSecret
  )
    throw new Error("Invalid Gmail client configuration");
  return {
    clientId: value.clientId,
    clientSecret: value.clientSecret,
    tokenKey: (await readFile(keyFile, "utf8")).trim(),
  };
}

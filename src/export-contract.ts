import { mkdir, writeFile } from "node:fs/promises";
import { createApp } from "./app.js";
const app = await createApp({
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://nivli:nivli@127.0.0.1:55432/nivli_test",
  adminSecret: "contract-only-placeholder".repeat(2),
  publicUrl: "https://nivli.example",
  environmentName: "Nivli",
  pushMode: "disabled",
  modelDataDestination: "No model configured",
});
await app.ready();
await mkdir("contracts", { recursive: true });
await writeFile(
  "contracts/openapi.json",
  JSON.stringify(app.swagger(), null, 2) + "\n",
);
await app.close();

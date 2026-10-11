import { QueuedDTO, RunDTO, ModelDTO } from "./agent-contracts.js";
import { TaskActionDTO } from "./task-action-contracts.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import { FormatRegistry } from "@sinclair/typebox";
import {
  EnvironmentDTO,
  SessionDTO,
  CredentialsDTO,
  ErrorDTO,
} from "./contracts.js";
import { GmailStatusDTO, GmailConsentDTO } from "./gmail-routes.js";
import {
  CreateTaskDTO,
  TaskDTO,
  TaskPageDTO,
  NotificationPlansDTO,
  NotificationPlanCommandDTO,
} from "./task-contracts.js";
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

FormatRegistry.Set("uuid", (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
);
FormatRegistry.Set(
  "date-time",
  (value) =>
    /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)),
);
for (const [name, schema] of Object.entries({
  "input-accepted": QueuedDTO,
  "run-succeeded": RunDTO,
  "model-status": ModelDTO,
  "gmail-status": GmailStatusDTO,
  "gmail-consent": GmailConsentDTO,
  task: TaskDTO,
  "task-action": TaskActionDTO,
  "notification-plans": NotificationPlansDTO,
  "notification-plan-command": NotificationPlanCommandDTO,
  "task-page": TaskPageDTO,
  "task-command": CreateTaskDTO,
  environment: EnvironmentDTO,
  session: SessionDTO,
  credentials: CredentialsDTO,
  error: ErrorDTO,
})) {
  const example = JSON.parse(
    await readFile(`contracts/examples/${name}.json`, "utf8"),
  );
  if (!Value.Check(schema, example))
    throw new Error(`Public ${name} example no longer matches API contract`);
}

import { PlaceDTO, LocationPlanDTO } from "./location-contracts.js";
import { PushStatusDTO, PushRegistrationDTO } from "./push-contracts.js";
import { QueuedDTO, RunDTO, ModelDTO } from "./agent-contracts.js";
import { ConversationDTO } from "./conversation-contracts.js";
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
import { CreateTaskDTO, TaskDTO, TaskPageDTO } from "./task-contracts.js";
import { createApp } from "./app.js";
const app = await createApp({
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://haiji:haiji@127.0.0.1:55432/haiji_test",
  adminSecret: "contract-only-placeholder".repeat(2),
  publicUrl: "https://haiji.example",
  environmentName: "Haiji",
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
  "conversation-refused": ConversationDTO,
  "run-succeeded": RunDTO,
  "model-status": ModelDTO,
  "gmail-status": GmailStatusDTO,
  "gmail-consent": GmailConsentDTO,
  task: TaskDTO,
  "task-remote": TaskDTO,
  "task-location": TaskDTO,
  "location-plan": LocationPlanDTO,
  place: PlaceDTO,
  "task-location-command": CreateTaskDTO,
  "push-status": PushStatusDTO,
  "push-registration": PushRegistrationDTO,
  "task-action": TaskActionDTO,
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

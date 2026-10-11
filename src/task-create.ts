import { isQuiet } from "./quiet-hours.js";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import { CreateTaskDTO } from "./task-contracts.js";
export async function createTaskInTransaction(
  client: pg.PoolClient,
  identity: { ownerId: string; deviceId: string },
  input: Static<typeof CreateTaskDTO>,
  time: Date,
  source: { kind: "manual" | "instruction"; text: string },
) {
  await client.query(
    "INSERT INTO task(id,owner_id,title,background,deadline,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
    [
      input.taskId,
      identity.ownerId,
      input.title,
      input.background ?? "",
      input.deadline ?? null,
      time,
    ],
  );
  if (input.reminder) {
    const reminderId = randomUUID();
    await client.query(
      "INSERT INTO reminder(id,owner_id,task_id,instant,time_zone,original_expression) VALUES($1,$2,$3,$4,$5,$6)",
      [
        reminderId,
        identity.ownerId,
        input.taskId,
        input.reminder.instant,
        input.reminder.timeZone,
        source.kind === "instruction" ? source.text : input.reminder.instant,
      ],
    );
    if (input.localDeviceId) {
      const confirmed =
        !isQuiet(input.reminder.instant, input.reminder.timeZone) ||
        input.quietHoursConfirmed === true;
      const occurrenceId = randomUUID();
      await client.query(
        "INSERT INTO local_occurrence(id,owner_id,device_id,reminder_id,reminder_revision,logical_trigger_key,request_id,quiet_hours_confirmed,created_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
        [
          occurrenceId,
          identity.ownerId,
          identity.deviceId,
          reminderId,
          input.reminder.instant,
          "nivli." + occurrenceId + ".1",
          confirmed,
          time,
        ],
      );
      await client.query(
        "UPDATE reminder SET scheduling_status=$1 WHERE id=$2",
        [confirmed ? "local_pending" : "needs_confirmation", reminderId],
      );
    }
  }
  await client.query(
    "INSERT INTO task_evidence(id,owner_id,task_id,kind,text,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      identity.ownerId,
      input.taskId,
      source.kind,
      source.text,
      time,
    ],
  );
  await client.query(
    "INSERT INTO task_change_log(owner_id,task_id,revision,command_id,kind,created_at) VALUES($1,$2,1,$3,'created',$4)",
    [identity.ownerId, input.taskId, input.commandId, time],
  );
}

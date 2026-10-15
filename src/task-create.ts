import { createLocationPlan } from "./location-store.js";
import { PublicError } from "./app.js";
import { createRemoteOccurrence } from "./push-plans.js";
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
  if (input.reminder && input.locationReminder)
    throw new PublicError(
      422,
      "ONE_REMINDER_ONLY",
      "一件事项只能选择时间或地点提醒。",
    );
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
  if (input.locationReminder)
    await createLocationPlan(
      client,
      identity,
      input.taskId,
      input.locationReminder,
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
    {
      await createRemoteOccurrence(client, {
        ownerId: identity.ownerId,
        deviceId: identity.deviceId,
        reminderId,
        revision: 1,
        instant: input.reminder.instant,
        timeZone: input.reminder.timeZone,
        confirmed: input.quietHoursConfirmed === true,
        now: time,
        deadline: input.deadline,
        requireReady: !!input.remoteDeviceId,
      });
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

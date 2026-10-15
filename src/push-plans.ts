import type pg from "pg";
import { randomUUID } from "node:crypto";
import { PublicError } from "./app.js";
import { isQuiet } from "./quiet-hours.js";

/** Durable outbox: committing a task also commits the only remote send authority. */
export async function createRemoteOccurrence(
  c: pg.PoolClient,
  input: {
    ownerId: string;
    deviceId: string;
    reminderId: string;
    revision: number;
    instant: string;
    timeZone: string;
    confirmed: boolean;
    now: Date;
    requireReady?: boolean;
    allowElapsed?: boolean;
    deadline?: { kind: string; instant?: string } | null;
  },
) {
  const reg = (
    await c.query(
      "SELECT * FROM push_registration WHERE owner_id=$1 AND device_id=$2 FOR SHARE",
      [input.ownerId, input.deviceId],
    )
  ).rows[0];
  if (
    input.requireReady !== false &&
    (!reg?.enabled || !reg.authorized || reg.invalidated_at)
  )
    throw new PublicError(
      409,
      "REMOTE_NOT_READY",
      "请先在此设备启用远程通知并允许系统通知。",
    );
  const scheduled = new Date(input.instant);
  if (scheduled <= input.now && !input.allowElapsed)
    throw new PublicError(
      422,
      "NEW_REMINDER_TIME_REQUIRED",
      "请选择未来的提醒时间。",
    );
  let expiration = new Date(scheduled.getTime() + 15 * 60000);
  if (input.deadline?.kind === "instant" && input.deadline.instant) {
    const deadline = new Date(input.deadline.instant);
    if (deadline > scheduled && deadline < expiration) expiration = deadline;
  }
  const confirmed = !isQuiet(input.instant, input.timeZone) || input.confirmed;
  await c.query(
    `INSERT INTO remote_occurrence(id,owner_id,device_id,reminder_id,reminder_revision,quiet_hours_confirmed,scheduled_at,expires_at,next_attempt_at,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10)`,
    [
      randomUUID(),
      input.ownerId,
      input.deviceId,
      input.reminderId,
      input.revision,
      confirmed,
      scheduled,
      expiration,
      input.now,
      scheduled <= input.now ? "expired" : "planned",
    ],
  );
  await c.query(
    "UPDATE reminder SET scheduling_status=$1 WHERE owner_id=$2 AND id=$3",
    [
      confirmed ? "remote_planned" : "needs_confirmation",
      input.ownerId,
      input.reminderId,
    ],
  );
}

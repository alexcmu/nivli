import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Static } from "@sinclair/typebox";
import { LocationInputDTO } from "./location-contracts.js";
import { PublicError } from "./app.js";
export const placeDTO = (p: Record<string, any>) => ({
  id: p.id,
  revision: p.revision,
  name: p.name,
  latitude: p.latitude,
  longitude: p.longitude,
  radius: p.radius,
});
export async function createLocationPlan(
  c: pg.PoolClient,
  identity: { ownerId: string; deviceId: string },
  taskId: string,
  input: Static<typeof LocationInputDTO>,
  revision = 1,
  reminderId = randomUUID(),
) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  } catch {
    throw new PublicError(422, "INVALID_TIME_ZONE", "请选择有效时区。");
  }
  const p = (
    await c.query(
      "SELECT * FROM place WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE",
      [identity.ownerId, input.placeId],
    )
  ).rows[0];
  if (!p)
    throw new PublicError(404, "PLACE_NOT_FOUND", "此地点不存在，请重新选择。");
  if (p.revision !== input.placeRevision)
    throw new PublicError(
      409,
      "PLACE_CHANGED",
      "地点已修改，请核对新范围后重新确认。",
    );
  await c.query(
    `INSERT INTO reminder(id,owner_id,task_id,kind,instant,time_zone,original_expression,revision) VALUES($1,$2,$3,'location',NULL,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET active=true,kind='location',instant=NULL,time_zone=excluded.time_zone,original_expression=excluded.original_expression`,
    [
      reminderId,
      identity.ownerId,
      taskId,
      input.timeZone,
      (input.transition === "enter" ? "到达" : "离开") + p.name,
      revision,
    ],
  );
  await c.query(
    "INSERT INTO location_plan(id,owner_id,device_id,reminder_id,reminder_revision,place_id,place_revision,place_snapshot,transition,quiet_hours_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      identity.ownerId,
      identity.deviceId,
      reminderId,
      revision,
      p.id,
      p.revision,
      placeDTO(p),
      input.transition,
      input.quietHoursConfirmed === true,
    ],
  );
}

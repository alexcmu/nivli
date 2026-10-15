import { isQuiet } from "./quiet-hours.js";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { createHash, randomUUID } from "node:crypto";
import { PublicError } from "./app.js";
import { readTask } from "./tasks.js";
import { TaskDTO } from "./task-contracts.js";
import { TaskActionDTO } from "./task-action-contracts.js";
import { MutationHeaders, ErrorDTO } from "./contracts.js";
type Identity = { ownerId: string; deviceId: string; sessionId: string };
type Action = Static<typeof TaskActionDTO>;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
/** Caller holds a transaction. This boundary is also used by confirmed conversation changes. */
export async function executeTaskAction(
  c: pg.PoolClient,
  identity: Identity,
  taskId: string,
  b: Action,
  time: Date,
  key: string,
) {
  const ref = "/v1/tasks/" + taskId;
  const conflict = (code: string, message: string): never => {
    throw new PublicError(409, code, message, false, ref);
  };
  await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
    identity.ownerId,
  ]);
  const auth = await c.query(
    "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND s.device_id=$3 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
    [identity.sessionId, identity.ownerId, identity.deviceId],
  );
  if (!auth.rowCount)
    throw new PublicError(401, "UNAUTHENTICATED", "身份无效，请重新连接。");
  const digest = createHash("sha256")
    .update(canonical({ taskId, ...b }))
    .digest("hex");
  const prior = (
    await c.query(
      "SELECT * FROM task_command WHERE owner_id=$1 AND (client_mutation_id=$5 OR (device_id=$2 AND (command_id=$3 OR idempotency_key=$4 OR command_id IN(SELECT command_id FROM task_command_key WHERE owner_id=$1 AND device_id=$2 AND idempotency_key=$4))))",
      [
        identity.ownerId,
        identity.deviceId,
        b.commandId,
        key,
        b.clientMutationId,
      ],
    )
  ).rows;
  if (prior.length) {
    if (prior.some((r) => r.body_hash !== digest))
      conflict("IDEMPOTENCY_CONFLICT", "相同操作标识的内容不同。");
    if (new Date(prior[0].expires_at) <= time)
      throw new PublicError(
        410,
        "OPERATION_EXPIRED",
        "此操作已过期，请核对事项。",
      );
    await c.query(
      "INSERT INTO task_command_key(owner_id,device_id,idempotency_key,command_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [identity.ownerId, identity.deviceId, key, b.commandId],
    );
    return prior[0].result;
  }
  const before = await readTask(c, identity.ownerId, taskId);
  if (before.revision !== b.expectedRevision)
    conflict("REVISION_CONFLICT", "事项已更新，请核对最新状态。");
  if (b.occurrence) {
    const o = before.reminder?.occurrence;
    if (
      !o ||
      o.id !== b.occurrence.id ||
      o.reminderRevision !== b.occurrence.reminderRevision ||
      o.routingVersion !== b.occurrence.routingVersion ||
      o.requestId !== b.occurrence.requestId
    )
      conflict("STALE_PLAN", "旧提醒不能修改最新计划。");
  }
  let state = {
    status: before.status,
    title: before.title,
    background: before.background,
    deadline: before.deadline,
    reminder: before.reminder
      ? { instant: before.reminder.instant, timeZone: before.reminder.timeZone }
      : null,
  };
  if (b.operation === "undo") {
    if (!b.targetMutationId)
      throw new PublicError(422, "INVALID_INPUT", "请选择要撤销的操作。");
    const target = (
      await c.query(
        "SELECT before_state,result,expires_at FROM task_command WHERE owner_id=$1 AND task_id=$2 AND client_mutation_id=$3",
        [identity.ownerId, taskId, b.targetMutationId],
      )
    ).rows[0];
    if (!target?.before_state || target.result.revision !== before.revision)
      conflict("UNDO_CONFLICT", "之后已有修改，无法覆盖最新状态。");
    if (new Date(target.expires_at) <= time)
      throw new PublicError(
        410,
        "OPERATION_EXPIRED",
        "撤销窗口已过期，请核对事项后明确修改。",
        false,
        ref,
      );
    const old = target.before_state;
    state = {
      status: old.status,
      title: old.title,
      background: old.background,
      deadline: old.deadline,
      reminder: old.reminder
        ? { instant: old.reminder.instant, timeZone: old.reminder.timeZone }
        : null,
    };
    if (b.reminder !== undefined) state.reminder = b.reminder;
  } else if (b.operation === "restore") {
    if (before.status === "active")
      conflict("STATE_CONFLICT", "事项已经处于进行中。");
    state.status = "active";
    const old = (
      await c.query(
        "SELECT before_state FROM task_command WHERE owner_id=$1 AND task_id=$2 AND (result->>'revision')::integer=$3 AND before_state IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [identity.ownerId, taskId, before.revision],
      )
    ).rows[0]?.before_state?.reminder;
    if (old) state.reminder = { instant: old.instant, timeZone: old.timeZone };
    if (b.reminder !== undefined) state.reminder = b.reminder;
  } else {
    if (before.status !== "active")
      conflict("STATE_CONFLICT", "事项已结束，请明确恢复后再修改。");
    if (b.operation === "complete") state.status = "completed";
    else if (b.operation === "cancel") state.status = "cancelled";
    else if (b.operation === "snooze") {
      if (!b.reminder)
        throw new PublicError(422, "INVALID_INPUT", "请选择新的提醒时间。");
      state.reminder = b.reminder;
    } else {
      if (b.title !== undefined) state.title = b.title;
      if (b.background !== undefined) state.background = b.background;
      if (b.deadline !== undefined) state.deadline = b.deadline;
      if (b.reminder !== undefined) state.reminder = b.reminder;
    }
  }
  if (!state.title.trim())
    throw new PublicError(422, "INVALID_INPUT", "请填写事项标题。");
  for (const v of [state.reminder, state.deadline])
    if (v) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v.timeZone });
      } catch {
        throw new PublicError(422, "INVALID_INPUT", "请核对时区。");
      }
    }
  if (state.deadline?.kind === "date") {
    const date = new Date(state.deadline.date + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== state.deadline.date
    )
      throw new PublicError(422, "INVALID_INPUT", "请核对截止日期。");
  }
  if (
    state.status === "active" &&
    state.reminder &&
    new Date(state.reminder.instant) <= time &&
    (b.operation === "restore" ||
      b.operation === "undo" ||
      b.operation === "snooze" ||
      b.reminder !== undefined)
  )
    throw new PublicError(
      422,
      "NEW_REMINDER_TIME_REQUIRED",
      "原提醒时间已过去，请选择新的具体时间。",
      false,
      ref,
    );
  const revision = before.revision + 1;
  await c.query(
    "UPDATE task SET revision=$1,status=$2,title=$3,background=$4,deadline=$5,updated_at=$6 WHERE owner_id=$7 AND id=$8",
    [
      revision,
      state.status,
      state.title,
      state.background,
      state.deadline,
      time,
      identity.ownerId,
      taskId,
    ],
  );
  // Every command invalidates the old occurrence in the same transaction.
  await c.query(
    "UPDATE local_occurrence SET invalidated_at=$1 WHERE owner_id=$2 AND reminder_id IN(SELECT id FROM reminder WHERE owner_id=$2 AND task_id=$3) AND invalidated_at IS NULL",
    [time, identity.ownerId, taskId],
  );
  const existing = (
    await c.query(
      "SELECT * FROM reminder WHERE owner_id=$1 AND task_id=$2 ORDER BY revision DESC LIMIT 1",
      [identity.ownerId, taskId],
    )
  ).rows[0];
  await c.query(
    "UPDATE reminder SET active=false,revision=revision+1,scheduling_status='not_scheduled' WHERE owner_id=$1 AND task_id=$2",
    [identity.ownerId, taskId],
  );
  if (state.status === "active" && state.reminder) {
    const reminderId = existing?.id ?? randomUUID(),
      reminderRevision = existing ? existing.revision + 1 : 1;
    const confirmed =
      !isQuiet(state.reminder.instant, state.reminder.timeZone) ||
      b.quietHoursConfirmed === true ||
      (before.reminder?.instant === state.reminder.instant &&
        before.reminder?.timeZone === state.reminder.timeZone &&
        before.reminder?.occurrence?.quietHoursConfirmed === true);
    if (existing)
      await c.query(
        "UPDATE reminder SET active=true,instant=$1,time_zone=$2,scheduling_status=$3 WHERE owner_id=$4 AND id=$5",
        [
          state.reminder.instant,
          state.reminder.timeZone,
          confirmed ? "local_pending" : "needs_confirmation",
          identity.ownerId,
          reminderId,
        ],
      );
    else
      await c.query(
        "INSERT INTO reminder(id,owner_id,task_id,instant,time_zone,original_expression,scheduling_status) VALUES($1,$2,$3,$4,$5,$4,$6)",
        [
          reminderId,
          identity.ownerId,
          taskId,
          state.reminder.instant,
          state.reminder.timeZone,
          confirmed ? "local_pending" : "needs_confirmation",
        ],
      );
    const occurrenceId = randomUUID();
    await c.query(
      "INSERT INTO local_occurrence(id,owner_id,device_id,reminder_id,reminder_revision,logical_trigger_key,request_id,quiet_hours_confirmed,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        occurrenceId,
        identity.ownerId,
        identity.deviceId,
        reminderId,
        reminderRevision,
        state.reminder.instant,
        "haiji." + occurrenceId + ".1",
        confirmed,
        time,
      ],
    );
  }
  await c.query(
    "INSERT INTO task_change_log(owner_id,task_id,revision,command_id,kind,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [identity.ownerId, taskId, revision, b.commandId, b.operation, time],
  );
  const result = await readTask(c, identity.ownerId, taskId);
  await c.query(
    "INSERT INTO task_command(owner_id,device_id,command_id,idempotency_key,body_hash,task_id,result,created_at,expires_at,client_mutation_id,before_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      identity.ownerId,
      identity.deviceId,
      b.commandId,
      key,
      digest,
      taskId,
      result,
      time,
      new Date(time.getTime() + 90 * 86400000),
      b.clientMutationId,
      before,
    ],
  );
  await c.query(
    "INSERT INTO task_command_key(owner_id,device_id,idempotency_key,command_id) VALUES($1,$2,$3,$4)",
    [identity.ownerId, identity.deviceId, key, b.commandId],
  );
  return result;
}
export async function registerTaskActions(
  instance: FastifyInstance,
  ctx: {
    pool: pg.Pool;
    session: (authorization?: string) => Promise<Identity>;
    now: () => Date;
  },
) {
  instance.withTypeProvider<TypeBoxTypeProvider>().post(
    "/v1/tasks/:id/commands",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        headers: MutationHeaders,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: TaskActionDTO,
        response: {
          200: TaskDTO,
          401: ErrorDTO,
          404: ErrorDTO,
          409: ErrorDTO,
          410: ErrorDTO,
          422: ErrorDTO,
          503: ErrorDTO,
        },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization),
        c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        const result = await executeTaskAction(
          c,
          identity,
          req.params.id,
          req.body,
          ctx.now(),
          req.headers["idempotency-key"],
        );
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  );
}

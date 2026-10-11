import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { Type, type Static } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { createHash, randomUUID } from "node:crypto";
import { PublicError } from "./app.js";
import { CreateTaskDTO, TaskDTO, TaskPageDTO } from "./task-contracts.js";
import { MutationHeaders, ErrorDTO } from "./contracts.js";
type Identity = { ownerId: string; deviceId: string; sessionId: string };
type Context = {
  pool: pg.Pool;
  session: (authorization?: string) => Promise<Identity>;
  now: () => Date;
};
type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;
const errors = {
  401: ErrorDTO,
  404: ErrorDTO,
  409: ErrorDTO,
  410: ErrorDTO,
  422: ErrorDTO,
  503: ErrorDTO,
};
const security = [{ bearerAuth: [] }];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const iso = (v: Date | string) => new Date(v).toISOString();
function validateInput(input: Static<typeof CreateTaskDTO>) {
  const invalid = () => {
    throw new PublicError(422, "INVALID_INPUT", "请核对标题、日期和时区。");
  };
  if (!input.title.trim()) invalid();
  for (const v of [input.reminder, input.deadline])
    if (v) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v.timeZone });
      } catch {
        invalid();
      }
    }
  if (input.deadline?.kind === "date") {
    const parsed = new Date(input.deadline.date + "T00:00:00Z");
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== input.deadline.date
    )
      invalid();
  }
}
async function readTask(
  db: Queryable,
  owner: string,
  id: string,
): Promise<Static<typeof TaskDTO>> {
  const task = (
    await db.query("SELECT * FROM task WHERE owner_id=$1 AND id=$2", [
      owner,
      id,
    ])
  ).rows[0];
  if (!task) throw new PublicError(404, "TASK_NOT_FOUND", "此事项不存在。");
  const reminder = (
    await db.query(
      "SELECT * FROM reminder WHERE owner_id=$1 AND task_id=$2 AND active",
      [owner, id],
    )
  ).rows[0];
  const sources = (
    await db.query(
      "SELECT * FROM task_evidence WHERE owner_id=$1 AND task_id=$2 ORDER BY created_at,id",
      [owner, id],
    )
  ).rows;
  return {
    id: task.id,
    ownerId: task.owner_id,
    revision: task.revision,
    status: task.status,
    title: task.title,
    background: task.background,
    deadline: task.deadline,
    createdAt: iso(task.created_at),
    updatedAt: iso(task.updated_at),
    reminder: reminder
      ? {
          id: reminder.id,
          revision: reminder.revision,
          instant: iso(reminder.instant),
          timeZone: reminder.time_zone,
          schedulingStatus: reminder.scheduling_status,
        }
      : null,
    sources: sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      text: s.text,
      createdAt: iso(s.created_at),
    })),
  };
}
export async function registerTasks(instance: FastifyInstance, ctx: Context) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.post(
    "/v1/tasks",
    {
      schema: {
        security,
        headers: MutationHeaders,
        body: CreateTaskDTO,
        response: { 200: TaskDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization),
        input = req.body,
        time = ctx.now();
      validateInput(input);
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
          identity.ownerId,
        ]);
        const authorized = await client.query(
          "SELECT s.id FROM session s JOIN device d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND s.device_id=$3 AND s.revoked_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF s,d",
          [identity.sessionId, identity.ownerId, identity.deviceId],
        );
        if (!authorized.rowCount)
          throw new PublicError(
            401,
            "UNAUTHENTICATED",
            "身份无效，请重新连接。",
          );
        const digest = createHash("sha256")
          .update(canonical(input))
          .digest("hex");
        const previous = (
          await client.query(
            "SELECT * FROM task_command WHERE owner_id=$1 AND device_id=$2 AND (command_id=$3 OR idempotency_key=$4 OR command_id IN(SELECT command_id FROM task_command_key WHERE owner_id=$1 AND device_id=$2 AND idempotency_key=$4))",
            [
              identity.ownerId,
              identity.deviceId,
              input.commandId,
              req.headers["idempotency-key"],
            ],
          )
        ).rows;
        if (previous.length) {
          if (previous.some((r) => r.body_hash !== digest))
            throw new PublicError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "相同操作标识的内容不同。",
              false,
              `/v1/tasks/${previous[0].task_id}`,
            );
          if (new Date(previous[0].expires_at) <= time)
            throw new PublicError(
              410,
              "OPERATION_EXPIRED",
              "此操作已过期，请核对事项。",
            );
          await client.query(
            "INSERT INTO task_command_key(owner_id,device_id,idempotency_key,command_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
              input.commandId,
            ],
          );
          await client.query("COMMIT");
          return previous[0].result;
        }

        if (
          (
            await client.query(
              "SELECT id FROM task WHERE owner_id=$2 AND id=$1",
              [input.taskId, identity.ownerId],
            )
          ).rowCount
        )
          throw new PublicError(
            409,
            "TASK_ID_CONFLICT",
            "事项标识已存在，请核对当前事项。",
            false,
            `/v1/tasks/${input.taskId}`,
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
        if (input.reminder)
          await client.query(
            "INSERT INTO reminder(id,owner_id,task_id,instant,time_zone,original_expression) VALUES($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              identity.ownerId,
              input.taskId,
              input.reminder.instant,
              input.reminder.timeZone,
              input.reminder.instant,
            ],
          );
        await client.query(
          "INSERT INTO task_evidence(id,owner_id,task_id,kind,text,created_at) VALUES($1,$2,$3,'manual',$4,$5)",
          [
            randomUUID(),
            identity.ownerId,
            input.taskId,
            input.background || input.title,
            time,
          ],
        );
        await client.query(
          "INSERT INTO task_change_log(owner_id,task_id,revision,command_id,kind,created_at) VALUES($1,$2,1,$3,'created',$4)",
          [identity.ownerId, input.taskId, input.commandId, time],
        );
        const result = await readTask(client, identity.ownerId, input.taskId);
        await client.query(
          "INSERT INTO task_command(owner_id,device_id,command_id,idempotency_key,body_hash,task_id,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            identity.ownerId,
            identity.deviceId,
            input.commandId,
            req.headers["idempotency-key"],
            digest,
            input.taskId,
            result,
            time,
            new Date(time.getTime() + 90 * 86400000),
          ],
        );
        await client.query(
          "INSERT INTO task_command_key(owner_id,device_id,idempotency_key,command_id) VALUES($1,$2,$3,$4)",
          [
            identity.ownerId,
            identity.deviceId,
            req.headers["idempotency-key"],
            input.commandId,
          ],
        );
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  );
  app.get(
    "/v1/tasks",
    {
      schema: {
        security,
        querystring: Type.Object(
          {
            status: Type.Optional(
              Type.Union([
                Type.Literal("active"),
                Type.Literal("completed"),
                Type.Literal("cancelled"),
                Type.Literal("all"),
              ]),
            ),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            cursor: Type.Optional(Type.String({ maxLength: 1000 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: TaskPageDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization),
        status = req.query.status ?? "active",
        limit = req.query.limit ?? 50;
      let anchor: {
        instant: string | null;
        id: string;
        status: string;
      } | null = null;
      if (req.query.cursor) {
        try {
          anchor = JSON.parse(
            Buffer.from(req.query.cursor, "base64url").toString(),
          );
          if (
            !anchor ||
            anchor.status !== status ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
              anchor.id,
            ) ||
            (anchor.instant !== null &&
              !Number.isFinite(Date.parse(anchor.instant)))
          )
            throw new Error();
        } catch {
          throw new PublicError(
            422,
            "INVALID_CURSOR",
            "分页标识无效，请重新加载。",
          );
        }
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const rows = (
          await client.query(
            `SELECT t.id,r.instant FROM task t LEFT JOIN reminder r ON r.owner_id=t.owner_id AND r.task_id=t.id AND r.active WHERE t.owner_id=$1 AND ($2='all' OR t.status=$2) AND ($3::uuid IS NULL OR (coalesce(r.instant,'infinity'::timestamptz),t.id)>(coalesce($4::timestamptz,'infinity'::timestamptz),$3::uuid)) ORDER BY coalesce(r.instant,'infinity'::timestamptz),t.id LIMIT $5`,
            [
              identity.ownerId,
              status,
              anchor?.id ?? null,
              anchor?.instant ?? null,
              limit + 1,
            ],
          )
        ).rows;
        const selected = rows.slice(0, limit),
          tasks = [];
        for (const r of selected)
          tasks.push(await readTask(client, identity.ownerId, r.id));
        const last = selected.at(-1),
          nextCursor =
            rows.length > limit && last
              ? Buffer.from(
                  JSON.stringify({
                    id: last.id,
                    instant: last.instant ? iso(last.instant) : null,
                    status,
                  }),
                ).toString("base64url")
              : null;
        await client.query("COMMIT");
        return { tasks, nextCursor };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  );
  app.get(
    "/v1/tasks/:id",
    {
      schema: {
        security,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: TaskDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization);
      return readTask(ctx.pool, identity.ownerId, req.params.id);
    },
  );
}

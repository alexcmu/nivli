import type pg from "pg";
import { randomUUID } from "node:crypto";
import { PublicError } from "./app.js";
import { readTask } from "./tasks.js";
import type { AgentInput, Proposal, ChangeProposal } from "./pi-adapter.js";
export type ConversationBody = {
  conversationId?: string;
  replyToInputId?: string;
  taskId?: string;
};
export async function acceptConversationInput(
  c: pg.PoolClient,
  identity: { ownerId: string },
  b: ConversationBody,
  now: Date,
) {
  let id = b.conversationId;
  if (!id) {
    if (b.replyToInputId)
      throw new PublicError(422, "INVALID_REPLY", "请指定原会话。");
    id = randomUUID();
    await c.query(
      "INSERT INTO conversation(id,owner_id,created_at) VALUES($1,$2,$3)",
      [id, identity.ownerId, now],
    );
  }
  const conversation = (
    await c.query(
      "SELECT * FROM conversation WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [id, identity.ownerId],
    )
  ).rows[0];
  if (!conversation)
    throw new PublicError(404, "CONVERSATION_NOT_FOUND", "此会话不存在。");
  if (b.replyToInputId) {
    const prior = (
      await c.query(
        "SELECT i.id,r.status FROM input_event i JOIN agent_run r ON r.input_id=i.id WHERE i.id=$1 AND i.conversation_id=$2 AND i.owner_id=$3",
        [b.replyToInputId, id, identity.ownerId],
      )
    ).rows[0];
    if (
      !prior ||
      !["clarification", "needs_clarification"].includes(prior.status)
    )
      throw new PublicError(409, "INVALID_REPLY", "请核对当前澄清问题。");
  }
  if (b.taskId) await readTask(c, identity.ownerId, b.taskId);
  const revision = conversation.accepted_revision + 1;
  await c.query("UPDATE conversation SET accepted_revision=$2 WHERE id=$1", [
    id,
    revision,
  ]);
  return { conversationId: id, conversationRevision: revision };
}
export async function loadConversationContext(
  pool: pg.Pool,
  input: Record<string, any>,
) {
  if (!input.conversation_id) return undefined;
  const stored = (
    await pool.query("SELECT agent_context FROM input_event WHERE id=$1", [
      input.id,
    ])
  ).rows[0]?.agent_context;
  if (stored) return stored as NonNullable<AgentInput["context"]>;
  const recent = (
    await pool.query(
      `SELECT i.id,i.text,i.time_zone,i.reply_to_input_id,i.created_at,r.status,r.message,r.task_id FROM input_event i JOIN agent_run r ON r.input_id=i.id WHERE i.conversation_id=$1 AND i.owner_id=$2 AND i.conversation_revision<$3 ORDER BY i.conversation_revision DESC LIMIT 8`,
      [input.conversation_id, input.owner_id, input.conversation_revision],
    )
  ).rows.reverse();
  const ids: string[] = input.selected_task_id
    ? [input.selected_task_id]
    : [...new Set(recent.filter((r) => r.task_id).map((r) => r.task_id))].slice(
        -4,
      );
  const tasks = [];
  for (const id of ids) {
    const t = await readTask(pool, input.owner_id, id);
    tasks.push({
      id: t.id,
      title: t.title,
      status: t.status,
      revision: t.revision,
      reminder: t.reminder,
      deadline: t.deadline,
    });
  }
  const context = {
    messages: recent.map((r) => ({
      inputId: r.id,
      replyToInputId: r.reply_to_input_id ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      text: r.text.slice(0, 500),
      timeZone: r.time_zone,
      status: r.status,
      message: r.message?.slice(0, 500),
      taskId: r.task_id,
    })),
    tasks,
    replyToInputId: input.reply_to_input_id ?? undefined,
    selectedTaskId: input.selected_task_id ?? undefined,
  };
  await pool.query(
    "UPDATE input_event SET agent_context=$2 WHERE id=$1 AND agent_context IS NULL",
    [input.id, context],
  );
  return context;
}
export async function commitConversationResult(
  c: pg.PoolClient,
  input: Record<string, any>,
) {
  if (input.conversation_id)
    await c.query(
      "UPDATE conversation SET committed_revision=GREATEST(committed_revision,$2) WHERE id=$1 AND owner_id=$3",
      [input.conversation_id, input.conversation_revision, input.owner_id],
    );
}
export async function readConversation(
  pool: pg.Pool,
  ownerId: string,
  id: string,
) {
  const conversation = (
    await pool.query("SELECT * FROM conversation WHERE id=$1 AND owner_id=$2", [
      id,
      ownerId,
    ])
  ).rows[0];
  if (!conversation)
    throw new PublicError(404, "CONVERSATION_NOT_FOUND", "此会话不存在。");
  const rows = (
    await pool.query(
      `SELECT i.id,i.text,i.time_zone,i.reply_to_input_id,i.conversation_revision,r.id AS run_id,r.status,r.message,r.task_id FROM input_event i JOIN agent_run r ON r.input_id=i.id WHERE i.conversation_id=$1 AND i.owner_id=$2 ORDER BY i.conversation_revision DESC LIMIT 30`,
      [id, ownerId],
    )
  ).rows.reverse();
  const messages = [];
  for (const r of rows)
    messages.push({
      inputId: r.id,
      runId: r.run_id,
      revision: r.conversation_revision,
      text: r.text,
      timeZone: r.time_zone,
      status: r.status,
      ...(r.message ? { message: r.message } : {}),
      ...(r.reply_to_input_id ? { replyToInputId: r.reply_to_input_id } : {}),
      ...(r.task_id ? { task: await readTask(pool, ownerId, r.task_id) } : {}),
    });
  return {
    id,
    revision: conversation.committed_revision,
    acceptedRevision: conversation.accepted_revision,
    messages,
  };
}

export function linkedInstruction(
  input: AgentInput,
): { text: string; now: string } | undefined {
  if (!input.context?.replyToInputId) return undefined;
  const chain = [];
  let id: string | undefined = input.context.replyToInputId;
  while (id && chain.length < 8) {
    const m = input.context.messages.find((m) => m.inputId === id);
    if (!m || !["clarification", "needs_clarification"].includes(m.status))
      return undefined;
    chain.unshift(m);
    id = m.replyToInputId;
  }
  if (!chain.length || id || chain.some((m) => m.timeZone !== input.timeZone))
    return undefined;
  const original = chain[0]!;
  if (!/(提醒我|remind me|set.{0,12}reminder)/i.test(original.text))
    return undefined;
  return {
    text: [...chain.map((m) => m.text), input.text].join("\n"),
    now: original.createdAt ?? input.now,
  };
}

export async function applyConversationChange(
  c: pg.PoolClient,
  identity: { ownerId: string; deviceId: string; sessionId: string },
  input: AgentInput,
  change: import("./pi-adapter.js").ChangeProposal,
  now: Date,
): Promise<string> {
  const tasks = input.context?.tasks ?? [];
  const target = tasks.find((t) => t.id === change.taskId);
  if (
    !target ||
    (tasks.length !== 1 && input.context?.selectedTaskId !== change.taskId) ||
    change.expectedRevision !== String(target.revision) ||
    change.instruction !== input.text ||
    target.status !== "active"
  )
    throw new PublicError(
      409,
      "CONVERSATION_CONFLICT",
      "请指定事项并核对当前状态；原话已保留。",
    );
  let reminder: { instant: string; timeZone: string } | undefined;
  if (change.operation === "edit") {
    if (
      !/(改|推迟|移到|调整|change|move|reschedul)/i.test(input.text) ||
      !change.timeExpression ||
      !input.text.includes(change.timeExpression) ||
      !change.instant ||
      !change.timeZone ||
      !change.localDateTime
    )
      throw new PublicError(
        422,
        "CLARIFY_CHANGE",
        "请补充明确的新日期和时间。",
      );
    if (
      /当地|local time|travel|旅行/i.test(input.text) &&
      !input.text.includes(change.timeZone)
    )
      throw new PublicError(422, "CLARIFY_TIMEZONE", "请选定明确的时区。");
    const old = target.reminder;
    const explicitDate =
      /\d{4}[-年/]\d{1,2}[-月/]\d{1,2}|今天|明天|后天|today|tomorrow/i.test(
        change.timeExpression,
      );
    if (!explicitDate && (!old || old.timeZone !== change.timeZone))
      throw new PublicError(422, "CLARIFY_DATE", "请补充日期和时区。");
    if (
      old &&
      old.timeZone !== change.timeZone &&
      !input.text.includes(change.timeZone)
    )
      throw new PublicError(422, "CLARIFY_TIMEZONE", "请明确新时区。");
    const date = explicitDate
      ? ""
      : new Intl.DateTimeFormat("sv-SE", {
          timeZone: old.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(old.instant));
    const expression = [date, change.timeExpression].filter(Boolean).join(" ");
    const text = "remind me " + expression;
    const { validateProposal } = await import("./agent-validation.js");
    if (
      !validateProposal(
        {
          title: target.title,
          instant: change.instant,
          timeZone: change.timeZone,
          instruction: text,
          timeExpression: expression,
          localDateTime: change.localDateTime,
        },
        { ...input, text, timeZone: change.timeZone, context: undefined },
      )
    )
      throw new PublicError(
        422,
        "CLARIFY_CHANGE",
        "日期或时间不明确，请核对时区与夏令时。",
      );
    reminder = { instant: change.instant, timeZone: change.timeZone };
  } else if (change.operation === "complete") {
    if (!/(完成|做完|办完|complete|done|finished)/i.test(input.text))
      throw new PublicError(422, "CLARIFY_CHANGE", "请明确操作。");
  } else if (change.operation === "cancel") {
    if (!/(取消|cancel)/i.test(input.text))
      throw new PublicError(422, "CLARIFY_CHANGE", "请明确操作。");
  } else
    throw new PublicError(422, "CLARIFY_CHANGE", "请明确修改、完成或取消。");
  if (/不要|不改|别|do not|don't|maybe|wish|希望/i.test(input.text))
    throw new PublicError(422, "CLARIFY_CHANGE", "尚未确认操作。");
  const { executeTaskAction } = await import("./task-actions.js");
  await executeTaskAction(
    c,
    identity,
    change.taskId,
    {
      commandId: input.inputId,
      clientMutationId: input.inputId,
      expectedRevision: target.revision,
      operation: change.operation as "edit" | "complete" | "cancel",
      ...(reminder ? { reminder } : {}),
    },
    now,
    input.inputId,
  );
  await c.query(
    "INSERT INTO task_evidence(id,owner_id,task_id,kind,text,created_at) VALUES($1,$2,$3,'instruction',$4,$5) ON CONFLICT DO NOTHING",
    [input.inputId, identity.ownerId, change.taskId, input.text, now],
  );
  return change.taskId;
}

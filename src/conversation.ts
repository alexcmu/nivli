import type pg from "pg";
import { randomUUID } from "node:crypto";
import { PublicError } from "./app.js";
import { readTask } from "./tasks.js";
import type { AgentInput } from "./pi-adapter.js";
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
  const recent = (
    await pool.query(
      `SELECT i.id,i.text,i.time_zone,r.status,r.message,r.task_id FROM input_event i JOIN agent_run r ON r.input_id=i.id WHERE i.conversation_id=$1 AND i.owner_id=$2 AND i.conversation_revision<$3 ORDER BY i.conversation_revision DESC LIMIT 8`,
      [input.conversation_id, input.owner_id, input.conversation_revision],
    )
  ).rows.reverse();
  const ids: string[] = input.selected_task_id
    ? [input.selected_task_id]
    : [...new Set(recent.filter((r) => r.task_id).map((r) => r.task_id))].slice(
        -4,
      );
  const tasks = [];
  for (const id of ids) tasks.push(await readTask(pool, input.owner_id, id));
  return {
    messages: recent.map((r) => ({
      inputId: r.id,
      text: r.text.slice(0, 2000),
      timeZone: r.time_zone,
      status: r.status,
      message: r.message?.slice(0, 500),
      taskId: r.task_id,
    })),
    tasks,
    replyToInputId: input.reply_to_input_id ?? undefined,
    selectedTaskId: input.selected_task_id ?? undefined,
  };
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

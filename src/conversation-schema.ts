import type pg from "pg";
export async function migrateConversation(pool: pg.Pool) {
  await pool.query(`
CREATE TABLE IF NOT EXISTS conversation(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),accepted_revision integer NOT NULL DEFAULT 0,committed_revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL);
ALTER TABLE input_event ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversation(id);
ALTER TABLE input_event ADD COLUMN IF NOT EXISTS conversation_revision integer;
ALTER TABLE input_event ADD COLUMN IF NOT EXISTS reply_to_input_id uuid REFERENCES input_event(id);
ALTER TABLE input_event ADD COLUMN IF NOT EXISTS selected_task_id uuid REFERENCES task(id);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_input_revision ON input_event(conversation_id,conversation_revision);
`);
}

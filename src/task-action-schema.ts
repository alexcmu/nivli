import type pg from "pg";
export async function migrateTaskActions(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78121001)");
    await c.query(`
ALTER TABLE task_command ADD COLUMN IF NOT EXISTS client_mutation_id uuid;
ALTER TABLE task_command ADD COLUMN IF NOT EXISTS before_state jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS task_mutation_identity ON task_command(owner_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL;
ALTER TABLE task_change_log DROP CONSTRAINT IF EXISTS task_change_log_kind_check;
ALTER TABLE task_change_log ADD CONSTRAINT task_change_log_kind_check CHECK(kind IN ('created','edit','complete','cancel','snooze','restore','undo'));
INSERT INTO schema_version(version) VALUES(2) ON CONFLICT DO NOTHING;
`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

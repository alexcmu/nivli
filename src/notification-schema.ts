import type pg from "pg";
/** Upgrade ticket-02 databases as well as fresh installations, under the shared migration lock. */
export async function migrateLocalNotifications(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78121001)");
    await c.query(` ALTER TABLE reminder DROP CONSTRAINT IF EXISTS reminder_scheduling_status_check;
 ALTER TABLE reminder ADD CONSTRAINT reminder_scheduling_status_check CHECK(scheduling_status IN ('not_scheduled','needs_confirmation','local_pending','local_installed','permission_denied','capacity_exceeded','installation_failed'));
 CREATE TABLE IF NOT EXISTS local_occurrence(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id uuid NOT NULL,reminder_id uuid NOT NULL,reminder_revision integer NOT NULL CHECK(reminder_revision>0),routing_version integer NOT NULL DEFAULT 1 CHECK(routing_version>0),logical_trigger_key text NOT NULL,delivery_owner text NOT NULL DEFAULT 'local' CHECK(delivery_owner='local'),request_id text NOT NULL UNIQUE,installation_status text NOT NULL DEFAULT 'pending' CHECK(installation_status IN ('pending','installed','denied','capacity','failed')),quiet_hours_confirmed boolean NOT NULL,created_at timestamptz NOT NULL,UNIQUE(owner_id,device_id,reminder_id,reminder_revision,logical_trigger_key),FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id),FOREIGN KEY(owner_id,reminder_id) REFERENCES reminder(owner_id,id));
 CREATE TABLE IF NOT EXISTS notification_plan_command(owner_id uuid NOT NULL,device_id uuid NOT NULL,operation text NOT NULL,idempotency_key uuid NOT NULL,body_hash text NOT NULL,result jsonb NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(owner_id,device_id,operation,idempotency_key),FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id));
`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

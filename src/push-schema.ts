import type pg from "pg";
export async function migratePush(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78121001)");
    await c.query(`
CREATE TABLE IF NOT EXISTS push_test(id uuid PRIMARY KEY,device_id uuid NOT NULL REFERENCES device(id),status text NOT NULL CHECK(status IN ('sending','accepted','unknown','failed')),last_error text,created_at timestamptz NOT NULL,finished_at timestamptz);
CREATE TABLE IF NOT EXISTS push_registration (
 owner_id uuid NOT NULL, device_id uuid NOT NULL, topic text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('development','production')),
 token text NOT NULL, enabled boolean NOT NULL, authorized boolean NOT NULL,
 registered_at timestamptz NOT NULL, invalidated_at timestamptz,
 PRIMARY KEY(owner_id,device_id), FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id));
CREATE TABLE IF NOT EXISTS push_registration_command(owner_id uuid NOT NULL,device_id uuid NOT NULL,key uuid NOT NULL,body_hash text NOT NULL,PRIMARY KEY(owner_id,device_id,key));
CREATE TABLE IF NOT EXISTS remote_occurrence (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, device_id uuid NOT NULL,
 reminder_id uuid NOT NULL, reminder_revision integer NOT NULL,
 routing_version integer NOT NULL DEFAULT 1, delivery_owner text NOT NULL DEFAULT 'server' CHECK(delivery_owner='server'),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','sending','accepted','unknown','failed','expired','cancelled')),
 quiet_hours_confirmed boolean NOT NULL, scheduled_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
 attempt integer NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 last_error text, accepted_at timestamptz, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,reminder_id,reminder_revision),
 FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id),
 FOREIGN KEY(owner_id,reminder_id) REFERENCES reminder(owner_id,id));
CREATE INDEX IF NOT EXISTS remote_dispatch ON remote_occurrence(next_attempt_at) WHERE status='planned';
ALTER TABLE reminder DROP CONSTRAINT IF EXISTS reminder_scheduling_status_check;
INSERT INTO remote_occurrence(id,owner_id,device_id,reminder_id,reminder_revision,quiet_hours_confirmed,scheduled_at,expires_at,next_attempt_at,created_at,status)
 SELECT gen_random_uuid(),r.owner_id,d.id,r.id,r.revision,r.scheduling_status!='needs_confirmation',r.instant,LEAST(r.instant+interval '15 minutes',CASE WHEN t.deadline->>'kind'='instant' AND (t.deadline->>'instant')::timestamptz>r.instant THEN (t.deadline->>'instant')::timestamptz ELSE r.instant+interval '15 minutes' END),r.instant,clock_timestamp(),CASE WHEN r.instant<=clock_timestamp() THEN 'expired' ELSE 'planned' END
 FROM reminder r JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id JOIN device d ON d.owner_id=r.owner_id AND d.revoked_at IS NULL
 WHERE r.active AND r.kind='time' AND t.status='active' ON CONFLICT(owner_id,reminder_id,reminder_revision) DO NOTHING;
UPDATE reminder SET scheduling_status=CASE WHEN scheduling_status='needs_confirmation' THEN 'needs_confirmation' WHEN active AND EXISTS(SELECT 1 FROM remote_occurrence o WHERE o.owner_id=reminder.owner_id AND o.reminder_id=reminder.id AND o.reminder_revision=reminder.revision) THEN 'remote_planned' ELSE 'not_scheduled' END;
ALTER TABLE reminder ADD CONSTRAINT reminder_scheduling_status_check CHECK(scheduling_status IN ('not_scheduled','needs_confirmation','remote_planned'));
DROP TABLE IF EXISTS notification_plan_command;
DROP TABLE IF EXISTS local_occurrence;
INSERT INTO schema_version(version) VALUES(6) ON CONFLICT DO NOTHING;
INSERT INTO schema_version(version) VALUES(5) ON CONFLICT DO NOTHING;
`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

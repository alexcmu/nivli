import type pg from "pg";
export async function migrateTasks(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78121001)");
    await c.query(`
 CREATE UNIQUE INDEX IF NOT EXISTS device_owner_identity ON device(owner_id,id);
 CREATE TABLE IF NOT EXISTS task(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),title text NOT NULL CHECK(length(trim(title))>0),background text NOT NULL,deadline jsonb,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(owner_id,id));
 CREATE TABLE IF NOT EXISTS reminder(id uuid PRIMARY KEY,owner_id uuid NOT NULL,task_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),kind text NOT NULL DEFAULT 'time' CHECK(kind='time'),instant timestamptz NOT NULL,time_zone text NOT NULL,original_expression text NOT NULL,time_semantics text NOT NULL DEFAULT 'fixed_instant',active boolean NOT NULL DEFAULT true,scheduling_status text NOT NULL DEFAULT 'not_scheduled' CHECK(scheduling_status='not_scheduled'),UNIQUE(owner_id,id),FOREIGN KEY(owner_id,task_id) REFERENCES task(owner_id,id));
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_reminder ON reminder(owner_id,task_id) WHERE active;
 CREATE TABLE IF NOT EXISTS task_evidence(id uuid PRIMARY KEY,owner_id uuid NOT NULL,task_id uuid NOT NULL,kind text NOT NULL CHECK(kind='manual'),text text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(owner_id,id),FOREIGN KEY(owner_id,task_id) REFERENCES task(owner_id,id));
 CREATE TABLE IF NOT EXISTS task_command(owner_id uuid NOT NULL REFERENCES owner(id),device_id uuid NOT NULL REFERENCES device(id),command_id uuid NOT NULL,idempotency_key uuid NOT NULL,body_hash text NOT NULL,task_id uuid NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(owner_id,device_id,command_id),UNIQUE(owner_id,device_id,idempotency_key),FOREIGN KEY(owner_id,task_id) REFERENCES task(owner_id,id),FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id));
 CREATE TABLE IF NOT EXISTS task_command_key(owner_id uuid NOT NULL,device_id uuid NOT NULL,idempotency_key uuid NOT NULL,command_id uuid NOT NULL,PRIMARY KEY(owner_id,device_id,idempotency_key),FOREIGN KEY(owner_id,device_id,command_id) REFERENCES task_command(owner_id,device_id,command_id));
 CREATE TABLE IF NOT EXISTS task_change_log(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id uuid NOT NULL,task_id uuid NOT NULL,revision integer NOT NULL,command_id uuid NOT NULL,kind text NOT NULL CHECK(kind='created'),created_at timestamptz NOT NULL,FOREIGN KEY(owner_id,task_id) REFERENCES task(owner_id,id),UNIQUE(owner_id,task_id,revision));
 CREATE INDEX IF NOT EXISTS tasks_owner_status ON task(owner_id,status,id);
 `);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

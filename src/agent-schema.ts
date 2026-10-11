import type pg from "pg";
export async function migrateAgent(pool: pg.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS input_event(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),device_id uuid NOT NULL REFERENCES device(id),session_id uuid NOT NULL REFERENCES session(id),idempotency_key uuid NOT NULL,text text NOT NULL,time_zone text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(owner_id,device_id,idempotency_key));
 CREATE TABLE IF NOT EXISTS agent_run(id uuid PRIMARY KEY,input_id uuid NOT NULL UNIQUE REFERENCES input_event(id),owner_id uuid NOT NULL REFERENCES owner(id),status text NOT NULL CHECK(status IN('queued','running','succeeded','clarification','failed')),message text,task_id uuid REFERENCES task(id),started_at timestamptz,finished_at timestamptz,attempt integer NOT NULL DEFAULT 0,requests integer NOT NULL DEFAULT 0,tool_calls integer NOT NULL DEFAULT 0);
 ALTER TABLE agent_run ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
 CREATE TABLE IF NOT EXISTS agent_retry(run_id uuid NOT NULL REFERENCES agent_run(id),idempotency_key uuid NOT NULL,PRIMARY KEY(run_id,idempotency_key));
 ALTER TABLE task_evidence DROP CONSTRAINT IF EXISTS task_evidence_kind_check;
 ALTER TABLE task_evidence ADD CONSTRAINT task_evidence_kind_check CHECK(kind IN('manual','instruction'));`);
}

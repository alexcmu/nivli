import type pg from "pg";
export async function migrateAgent(pool: pg.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS input_event(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),device_id uuid NOT NULL REFERENCES device(id),session_id uuid NOT NULL REFERENCES session(id),idempotency_key uuid NOT NULL,text text NOT NULL,time_zone text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(owner_id,device_id,idempotency_key));
 CREATE TABLE IF NOT EXISTS agent_run(id uuid PRIMARY KEY,input_id uuid NOT NULL UNIQUE REFERENCES input_event(id),owner_id uuid NOT NULL REFERENCES owner(id),status text NOT NULL CHECK(status IN('queued','running','succeeded','clarification','failed')),message text,task_id uuid REFERENCES task(id),started_at timestamptz,finished_at timestamptz,attempt integer NOT NULL DEFAULT 0,requests integer NOT NULL DEFAULT 0,tool_calls integer NOT NULL DEFAULT 0);
 ALTER TABLE agent_run ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
 CREATE TABLE IF NOT EXISTS agent_retry(run_id uuid NOT NULL REFERENCES agent_run(id),idempotency_key uuid NOT NULL,PRIMARY KEY(run_id,idempotency_key));
 ALTER TABLE agent_run DROP CONSTRAINT IF EXISTS agent_run_status_check;
 UPDATE agent_run SET status='needs_clarification' WHERE status='clarification';
 ALTER TABLE agent_run ADD CONSTRAINT agent_run_status_check CHECK(status IN('queued','running','needs_clarification','succeeded','failed','cancelled','timed_out'));
 ALTER TABLE agent_run ADD COLUMN IF NOT EXISTS error_code text;
 ALTER TABLE agent_run ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
 ALTER TABLE agent_run ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
 CREATE TABLE IF NOT EXISTS agent_cancel(run_id uuid NOT NULL REFERENCES agent_run(id),idempotency_key uuid NOT NULL,PRIMARY KEY(run_id,idempotency_key));
 CREATE TABLE IF NOT EXISTS model_request(id uuid PRIMARY KEY,run_id uuid REFERENCES agent_run(id),attempt integer NOT NULL,budget_day date NOT NULL,reserved_usd numeric NOT NULL CHECK(reserved_usd>=0),max_output_tokens integer NOT NULL,settled boolean NOT NULL DEFAULT false,input_tokens integer,output_tokens integer,usage_usd numeric CHECK(usage_usd>=0),created_at timestamptz NOT NULL);
 ALTER TABLE model_request ALTER COLUMN run_id DROP NOT NULL;
 CREATE INDEX IF NOT EXISTS model_request_budget_day ON model_request(budget_day);
 ALTER TABLE task_evidence DROP CONSTRAINT IF EXISTS task_evidence_kind_check;
 ALTER TABLE task_evidence ADD CONSTRAINT task_evidence_kind_check CHECK(kind IN('manual','instruction'));`);
}

import type pg from "pg";
export async function migrateGmail(pool: pg.Pool) {
  await pool.query(`
 CREATE TABLE IF NOT EXISTS gmail_source(owner_id uuid PRIMARY KEY REFERENCES owner(id), account text, state text NOT NULL DEFAULT 'stopped', revision integer NOT NULL DEFAULT 0, label_ids jsonb NOT NULL DEFAULT '[]', initial_days integer NOT NULL DEFAULT 7, retention_days integer NOT NULL DEFAULT 7, authorized_after timestamptz, encrypted_tokens text, history_id text, scan jsonb, last_successful_sync timestamptz, sync_error text, failures integer NOT NULL DEFAULT 0, next_sync_at timestamptz, requested_at timestamptz, lease_until timestamptz);
 CREATE TABLE IF NOT EXISTS gmail_oauth(state_hash text PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),session_id uuid NOT NULL REFERENCES session(id),source_revision integer NOT NULL,consent jsonb NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz);
 CREATE TABLE IF NOT EXISTS gmail_operation(owner_id uuid NOT NULL REFERENCES owner(id),key text NOT NULL,kind text NOT NULL,digest text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner_id,key));
 CREATE TABLE IF NOT EXISTS gmail_source_item(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),account text NOT NULL,message_id text NOT NULL,content_version text NOT NULL,authorization_revision integer NOT NULL,received_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,encrypted_content text,UNIQUE(owner_id,account,message_id,content_version));
 CREATE TABLE IF NOT EXISTS gmail_event(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),source_item_id uuid NOT NULL REFERENCES gmail_source_item(id),authorization_revision integer NOT NULL,kind text NOT NULL DEFAULT 'source_item_available',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_item_id,authorization_revision));
 `);
}

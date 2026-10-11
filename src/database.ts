import { migrateAgent } from "./agent-schema.js";
import { migrateLocalNotifications } from "./notification-schema.js";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { migrateGmail } from "./gmail-schema.js";
import { migrateTasks } from "./task-schema.js";
export const SCHEMA_VERSION = 3;
export function connect(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  return { pool, db: drizzle(pool) };
}
export async function waitForDatabase(databaseUrl: string) {
  const { pool } = connect(databaseUrl);
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await pool.query("select 1");
        return;
      } catch {
        if (attempt === 29)
          throw new Error("Database unavailable after bounded retries");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    await pool.end();
  }
}
export async function migrate(databaseUrl: string) {
  await waitForDatabase(databaseUrl);
  const { pool, db } = connect(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(78121001)`);
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS schema_version(version integer PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS owner(id uuid PRIMARY KEY, singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton));
 CREATE TABLE IF NOT EXISTS device(id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owner(id), name text NOT NULL, revoked_at timestamptz);
 CREATE UNIQUE INDEX IF NOT EXISTS one_primary_device ON device(owner_id) WHERE revoked_at IS NULL;
 CREATE TABLE IF NOT EXISTS session(id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owner(id), device_id uuid NOT NULL REFERENCES device(id), access_hash text NOT NULL UNIQUE, refresh_hash text NOT NULL UNIQUE, access_expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL, revoked_at timestamptz);
 CREATE TABLE IF NOT EXISTS pairing(code_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, consumed_at timestamptz);
 CREATE TABLE IF NOT EXISTS rate_limit(bucket text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL);
 CREATE TABLE IF NOT EXISTS identity_operation(scope text NOT NULL, key text NOT NULL, body_hash text NOT NULL, encrypted_result text NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(scope,key));
 CREATE TABLE IF NOT EXISTS worker_heartbeat(role text PRIMARY KEY, seen_at timestamptz NOT NULL);
 INSERT INTO owner(id) VALUES ('00000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
 INSERT INTO schema_version(version) VALUES (1) ON CONFLICT DO NOTHING;`),
      );
    });
    await migrateGmail(pool);
    await migrateTasks(pool);
    await migrateLocalNotifications(pool);
    await migrateAgent(pool);
    await pool.query(
      "INSERT INTO schema_version(version) VALUES(3) ON CONFLICT DO NOTHING",
    );
    const boss = new PgBoss({ connectionString: databaseUrl });
    boss.on("error", () => {});
    await boss.start();
    for (const name of ["agent", "mailbox", "delivery", "maintenance"])
      await boss.createQueue(name);
    await boss.stop();
  } finally {
    await pool.end();
  }
}
export async function verifySchema(databaseUrl: string) {
  await waitForDatabase(databaseUrl);
  const { pool } = connect(databaseUrl);
  try {
    const r = await pool.query(
      "select max(version) as version from schema_version",
    );
    const gmail = await pool.query(
      "select to_regclass('gmail_source') as source",
    );
    if (!gmail.rows[0]?.source)
      throw new Error("Gmail schema missing; run migration before starting");
    const agent = await pool.query(
      "SELECT to_regclass('agent_run') AS runs,to_regclass('input_event') AS inputs,to_regclass('agent_retry') AS retries",
    );
    const tasks = await pool.query(
      "SELECT to_regclass('task_command_key') AS table_name, to_regclass('local_occurrence') AS occurrences, to_regclass('notification_plan_command') AS notification_commands",
    );
    if (
      r.rows[0]?.version !== SCHEMA_VERSION ||
      !agent.rows[0]?.runs ||
      !agent.rows[0]?.inputs ||
      !agent.rows[0]?.retries ||
      !tasks.rows[0]?.table_name ||
      !tasks.rows[0]?.occurrences ||
      !tasks.rows[0]?.notification_commands
    )
      throw new Error("Incompatible schema; run migration before starting");
  } finally {
    await pool.end();
  }
}

import type pg from "pg";
export async function migrateLocation(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78121001)");
    await c.query(`
ALTER TABLE reminder DROP CONSTRAINT IF EXISTS reminder_kind_check;
ALTER TABLE reminder ADD CONSTRAINT reminder_kind_check CHECK(kind IN ('time','location'));
ALTER TABLE reminder ALTER COLUMN instant DROP NOT NULL;
CREATE TABLE IF NOT EXISTS place(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owner(id),revision integer NOT NULL DEFAULT 1,name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),radius double precision NOT NULL CHECK(radius BETWEEN 100 AND 1000),deleted_at timestamptz,UNIQUE(owner_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS place_name ON place(owner_id,lower(name)) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS location_plan(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id uuid NOT NULL,reminder_id uuid NOT NULL,reminder_revision integer NOT NULL,place_id uuid NOT NULL,place_revision integer NOT NULL,place_snapshot jsonb NOT NULL,transition text NOT NULL CHECK(transition IN ('enter','exit')),installation_status text NOT NULL DEFAULT 'pending' CHECK(installation_status IN ('pending','monitoring','permission_denied','unavailable','capacity','needs_configuration','triggered','cancelled')),quiet_hours_confirmed boolean NOT NULL DEFAULT false,triggered_at timestamptz,UNIQUE(owner_id,reminder_id,reminder_revision),FOREIGN KEY(owner_id,reminder_id) REFERENCES reminder(owner_id,id),FOREIGN KEY(owner_id,device_id) REFERENCES device(owner_id,id),FOREIGN KEY(owner_id,place_id) REFERENCES place(owner_id,id));
CREATE TABLE IF NOT EXISTS location_command(owner_id uuid NOT NULL,device_id uuid NOT NULL,key uuid NOT NULL,body_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner_id,device_id,key));
INSERT INTO schema_version(version) VALUES(7) ON CONFLICT DO NOTHING;
`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

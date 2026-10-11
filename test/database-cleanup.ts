import type pg from "pg";

export async function dropFixtureDatabase(maintenance: pg.Pool, name: string) {
  if (!/^[a-z0-9_]+$/.test(name))
    throw new Error("Invalid fixture database name");
  // pg-pool 3.14.0 resolves end() before asynchronous client/backend exits finish.
  // Observe the drain before dropping; FORCE can kill closing clients with 57P01.
  for (let attempt = 0; attempt < 50; attempt++) {
    const active = await maintenance.query(
      "SELECT pid FROM pg_stat_activity WHERE datname=$1",
      [name],
    );
    if (active.rowCount === 0) {
      await maintenance.query(`DROP DATABASE "${name}"`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Fixture database ${name} still has connections after shutdown`,
  );
}

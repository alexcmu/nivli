import { readGmailConfig } from "./gmail-config.js";
import { startGmailWorker } from "./gmail-worker.js";
import { readFile } from "node:fs/promises";
import { createApp } from "./app.js";
import { migrate, verifySchema, connect } from "./database.js";
import { PgBoss } from "pg-boss";
import { sql } from "drizzle-orm";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const role = process.argv[2] ?? "api";
if (role === "migrate") {
  await migrate(databaseUrl);
} else if (role === "api") {
  const file = process.env.ADMIN_SECRET_FILE;
  if (!file) throw new Error("ADMIN_SECRET_FILE is required");
  const pushMode = process.env.PUSH_MODE ?? "disabled";
  if (!["self_signed", "disabled", "relay"].includes(pushMode))
    throw new Error("Invalid PUSH_MODE");
  const app = await createApp({
    gmail: await readGmailConfig(),
    databaseUrl,
    adminSecret: (await readFile(file, "utf8")).trim(),
    publicUrl: process.env.PUBLIC_URL ?? "",
    environmentName: process.env.ENVIRONMENT_NAME ?? "Nivli",
    pushMode: pushMode as "self_signed" | "disabled" | "relay",
    modelDataDestination:
      process.env.MODEL_DATA_DESTINATION ??
      "尚未配置模型，不会发送内容到模型服务。",
    logger: true,
  });
  await app.listen({ host: "0.0.0.0", port: 3000 });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      void app.close();
    });
} else if (role === "agent" || role === "delivery") {
  await verifySchema(databaseUrl);
  const gmail = role === "agent" ? await readGmailConfig() : undefined;
  const mailbox = gmail
    ? await startGmailWorker({
        databaseUrl,
        gmail,
        publicUrl: process.env.PUBLIC_URL ?? "",
      })
    : undefined;
  const { pool, db } = connect(databaseUrl);
  const boss = new PgBoss({ connectionString: databaseUrl, migrate: false });
  boss.on("error", () =>
    console.error("Queue connection failed; no private data logged"),
  );
  await boss.start();
  // Ticket 01 establishes real, isolated queue processes. Business consumers arrive in dependent tickets.
  const heartbeat = async () => {
    try {
      await db.execute(
        sql`INSERT INTO worker_heartbeat(role,seen_at) VALUES (${role},now()) ON CONFLICT(role) DO UPDATE SET seen_at=excluded.seen_at`,
      );
    } catch {
      console.error("Worker heartbeat failed");
    }
  };
  await heartbeat();
  const interval = setInterval(() => {
    void heartbeat();
  }, 10000);
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      clearInterval(interval);
      void Promise.all([boss.stop(), mailbox?.stop()]).then(() => pool.end());
    });
} else throw new Error("Unknown process role");

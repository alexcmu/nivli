import { readModelConfig } from "./model-config.js";
import { startAgentWorker } from "./agent-worker.js";
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
} else if (role === "api" || role === "serve") {
  // The Docker default runs the complete personal backend as one web service.
  // Existing Compose deployments retain their explicit api/agent roles.
  if (role === "serve") await migrate(databaseUrl);
  const file = process.env.ADMIN_SECRET_FILE;
  const adminSecret = file
    ? (await readFile(file, "utf8")).trim()
    : process.env.ADMIN_SECRET?.trim();
  if (!adminSecret)
    throw new Error("ADMIN_SECRET_FILE or ADMIN_SECRET is required");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
  const publicUrl =
    process.env.PUBLIC_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
      : "");
  const gmail = await readGmailConfig();
  const model = await readModelConfig();
  const pushMode = process.env.PUSH_MODE ?? "disabled";
  if (!["self_signed", "disabled", "relay"].includes(pushMode))
    throw new Error("Invalid PUSH_MODE");
  const app = await createApp({
    gmail,
    model,
    databaseUrl,
    adminSecret,
    publicUrl,
    environmentName: process.env.ENVIRONMENT_NAME ?? "Nivli",
    pushMode: pushMode as "self_signed" | "disabled" | "relay",
    modelDataDestination:
      process.env.MODEL_DATA_DESTINATION ??
      "尚未配置模型，不会发送内容到模型服务。",
    logger: true,
  });
  if (role === "serve") {
    const agent = await startAgentWorker({ databaseUrl, model });
    const mailbox = gmail
      ? await startGmailWorker({ databaseUrl, gmail, publicUrl })
      : undefined;
    app.addHook("onClose", async () => {
      await Promise.all([agent.stop(), mailbox?.stop()]);
    });
  }
  await app.listen({ host: "0.0.0.0", port });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      void app.close();
    });
} else if (role === "agent" || role === "delivery") {
  await verifySchema(databaseUrl);
  const agent =
    role === "agent"
      ? await startAgentWorker({ databaseUrl, model: await readModelConfig() })
      : undefined;
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
      void Promise.all([boss.stop(), mailbox?.stop(), agent?.stop()]).then(() =>
        pool.end(),
      );
    });
} else throw new Error("Unknown process role");

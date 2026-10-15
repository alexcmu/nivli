import { afterAll, beforeAll, expect, test } from "vitest";
import pg from "pg";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { dropFixtureDatabase } from "./database-cleanup.js";

const rootUrl =
  process.env.DATABASE_URL ??
  "postgres://haiji:haiji@127.0.0.1:55432/haiji_test";
const name = "runtime_" + randomUUID().replaceAll("-", "");
const database = new URL(rootUrl);
database.pathname = "/" + name;
const maintenance = new pg.Pool({ connectionString: rootUrl });
const admin = randomBytes(32).toString("hex");
let child: ChildProcess | undefined;
let logs = "";
let base = "";
let token = "";
let directory = "";

beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  directory = await mkdtemp(join(tmpdir(), "haiji-runtime-"));
});
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child?.kill("SIGKILL"), 10000);
  try {
    const [code, signal] = await exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(timer);
  }
}
afterAll(async () => {
  try {
    await stop();
  } finally {
    await dropFixtureDatabase(maintenance, name);
    await maintenance.end();
    await rm(directory, { recursive: true, force: true });
  }
});
async function start(role: string, extra: Record<string, string> = {}) {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  base = "http://127.0.0.1:" + port;
  // Keep administrator/model configuration outside the test process environment.
  const env = { ...process.env };
  for (const key of [
    "ADMIN_SECRET_FILE",
    "PUBLIC_URL",
    "ANTHROPIC_API_KEY",
    "MODEL_API_KEY_FILE",
    "GMAIL_CONFIG_FILE",
  ])
    delete env[key];
  child = spawn(process.execPath, ["dist/main.js", role], {
    env: {
      ...env,
      DATABASE_URL: database.toString(),
      ADMIN_SECRET: admin,
      RAILWAY_PUBLIC_DOMAIN: "runtime.up.railway.app",
      PORT: String(port),
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (data) => {
    logs += data.toString();
  });
  child.stderr?.on("data", (data) => {
    logs += data.toString();
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Runtime exited before readiness");
    try {
      if ((await fetch(base + "/health/ready")).ok) return;
    } catch {
      /* The real startup includes migration and worker initialization. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Runtime did not become ready");
}
async function call(path: string, payload?: object, authorization = token) {
  const response = await fetch(base + path, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + authorization,
      "idempotency-key": randomUUID(),
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("Docker serve migrates, processes queued inputs, and preserves pairing across restart with file secrets", async () => {
  await start("serve");
  expect((await call("/v1/environment")).body.host).toBe(
    "runtime.up.railway.app",
  );
  const pairing = await call("/v1/admin/pairings", {}, admin);
  expect(pairing.status).toBe(200);
  const claim = await call("/v1/pairings/claim", {
    code: pairing.body.code,
    deviceName: "Runtime fixture",
  });
  expect(claim.status).toBe(200);
  token = claim.body.accessToken;
  const taskId = randomUUID();
  expect(
    (
      await call("/v1/tasks", {
        taskId,
        commandId: randomUUID(),
        title: "Cloud runtime fixture",
        background: "Synthetic",
        reminder: {
          instant: new Date(Date.now() + 86400000).toISOString(),
          timeZone: "Etc/UTC",
        },
      })
    ).status,
  ).toBe(200);
  const accepted = await call("/v1/inputs", {
    text: "明天九点提醒我交材料",
    timeZone: "Asia/Shanghai",
  });
  expect(accepted.status).toBe(202);
  let run;
  for (let attempt = 0; attempt < 50; attempt++) {
    run = (await call("/v1/runs/" + accepted.body.runId)).body;
    if (run.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // A missing model is an honest business failure, proving the deployed worker
  // actually consumed the durable input rather than leaving it queued forever.
  expect(run).toMatchObject({ status: "failed", requests: 0, toolCalls: 0 });
  expect(run.message).toContain("尚未配置 AI 模型");
  await stop();
  const secretFile = join(directory, "admin-secret");
  await writeFile(secretFile, admin + "\n", { mode: 0o600 });
  await start("api", {
    ADMIN_SECRET_FILE: secretFile,
    ADMIN_SECRET: "wrong-environment-secret",
    PUBLIC_URL: "https://explicit.example",
  });
  expect((await call("/v1/environment")).body.host).toBe("explicit.example");
  expect((await call("/v1/session")).status).toBe(200);
  expect((await call("/v1/tasks/" + taskId)).body.title).toBe(
    "Cloud runtime fixture",
  );
  expect((await call("/v1/admin/pairings", {}, admin)).status).toBe(200);
  expect(
    (await call("/v1/admin/pairings", {}, "wrong-environment-secret")).status,
  ).toBe(401);
  await stop();
  expect(logs).not.toContain(admin);
  expect(logs).not.toContain(token);
}, 30000);

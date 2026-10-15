import { dropFixtureDatabase } from "./database-cleanup.js";
import { beforeAll, afterAll, test, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
const root =
  process.env.DATABASE_URL ??
  "postgres://haiji:haiji@127.0.0.1:55432/haiji_test";
const name = "gmail_" + randomUUID().replaceAll("-", "");
const url = new URL(root);
url.pathname = "/" + name;
const databaseUrl = url.toString();
const maintenance = new pg.Pool({ connectionString: root });
let app: Awaited<ReturnType<typeof createApp>>,
  base = "",
  token = "",
  logs = "";
const wallStart = Date.now();
let clock = Date.now(),
  failSecondPage = false,
  expireHistory = false,
  credentialInvalid = false,
  gateBody = false;
let releaseBody: (() => void) | undefined;
let bodyRequests: string[] = [];
let worker: Awaited<
  ReturnType<typeof import("../src/gmail-worker.js").startGmailWorker>
>;
const endpoint = () =>
  `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Public behavior did not settle");
};
const provider = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const path = new URL(req.url!, "http://localhost");
  if (credentialInvalid && path.pathname !== "/token") {
    res.statusCode = 401;
    res.end("{}");
    return;
  }
  if (path.pathname.endsWith("/history") && expireHistory) {
    expireHistory = false;
    res.statusCode = 404;
    res.end("{}");
    return;
  }
  if (path.pathname.endsWith("/messages")) {
    if (path.searchParams.get("pageToken") === "second" && failSecondPage) {
      failSecondPage = false;
      res.statusCode = 503;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify(
        path.searchParams.has("pageToken")
          ? { messages: [{ id: "mail-2" }, { id: "mail-1" }] }
          : {
              messages: [{ id: "mail-1" }, { id: "old" }, { id: "excluded" }],
              nextPageToken: "second",
            },
      ),
    );
    return;
  }
  if (path.pathname.includes("/messages/")) {
    const id = path.pathname.split("/").at(-1)!;
    const msg = {
      id,
      threadId: "thread-1",
      internalDate: String(id === "old" ? clock - 9 * 86400000 : clock - 1000),
      labelIds: [id === "excluded" ? "SPAM" : "INBOX"],
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "Subject", value: "Return book" }],
        body: {
          data: Buffer.from("Please bring my book on Friday").toString(
            "base64url",
          ),
        },
      },
    };
    if (path.searchParams.get("format") === "full") {
      bodyRequests.push(id);
      if (gateBody) {
        releaseBody = () => res.end(JSON.stringify(msg));
        return;
      }
    }
    res.end(JSON.stringify(msg));
    return;
  }
  res.end(
    JSON.stringify(
      path.pathname === "/token"
        ? {
            access_token: "secret-access",
            refresh_token: "secret-refresh",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }
        : path.pathname.endsWith("/history")
          ? {
              historyId: "101",
              history: [
                {
                  messagesAdded: [
                    { message: { id: "mail-1" } },
                    { message: { id: "mail-2" } },
                  ],
                },
              ],
            }
          : { emailAddress: "reader@example.com", historyId: "100" },
    ),
  );
});
const call = async (
  path: string,
  method = "GET",
  body?: unknown,
  bearer = token,
  key = randomUUID(),
) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      "idempotency-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  await migrate(databaseUrl);
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  app = await createApp({
    databaseUrl,
    adminSecret: "a".repeat(48),
    publicUrl: "https://haiji.example",
    environmentName: "test",
    pushMode: "disabled",
    modelDataDestination: "none",
    clock: () => new Date(clock + Date.now() - wallStart),
    logger: true,
    logStream: { write: (m) => (logs += m) },
    gmail: {
      clientId: "client",
      clientSecret: "secret",
      tokenKey: "b".repeat(64),
      authorizationEndpoint: endpoint + "/authorize",
      tokenEndpoint: endpoint + "/token",
      apiEndpoint: endpoint,
    },
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const p = await call("/v1/admin/pairings", "POST", {}, "a".repeat(48));
  token = (
    await call(
      "/v1/pairings/claim",
      "POST",
      { code: p.body.code, deviceName: "iPhone" },
      "",
    )
  ).body.accessToken;
});
afterAll(async () => {
  await worker?.stop();
  await app?.close();
  provider.close();
  await dropFixtureDatabase(maintenance, name);
  await maintenance.end();
});
test("Gmail consent uses readonly OAuth bound state; wrong callback and revoked session cannot connect", async () => {
  const consent = {
    labelIds: ["INBOX"],
    initialDays: 7,
    retentionDays: 7,
    confirmed: true,
    expectedRevision: 0,
  };
  const key = randomUUID();
  const start = await call("/v1/gmail/connect", "POST", consent, token, key);
  expect(start.status).toBe(200);
  expect(
    (await call("/v1/gmail/connect", "POST", consent, token, key)).body,
  ).toEqual(start.body);
  const auth = new URL(start.body.authorizationUrl);
  expect(auth.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/gmail.readonly",
  );
  const bad = await fetch(
    base +
      "/v1/gmail/oauth/callback?state=wrongwrongwrongwrongwrong&code=secret-code",
    { redirect: "manual" },
  );
  expect(bad.status).toBe(401);
  const valid = await fetch(
    base +
      "/v1/gmail/oauth/callback?state=" +
      auth.searchParams.get("state") +
      "&code=secret-code",
    { redirect: "manual" },
  );
  expect(valid.status).toBe(303);
  expect(valid.headers.get("location")).toBe("haiji://gmail?result=connected");
  const status = await call("/v1/gmail");
  expect(status.body).toMatchObject({
    state: "active",
    account: "reader@example.com",
    revision: 1,
    labelIds: ["INBOX"],
    initialDays: 7,
    lastSuccessfulSync: null,
    syncError: null,
  });
  expect(JSON.stringify(status)).not.toContain("secret-access");
  expect(logs).not.toContain("secret-code");
});

test("interrupted paging resumes its committed page and deduplicates repeated IDs without reading outside consent", async () => {
  const { startGmailWorker } = await import("../src/gmail-worker.js");
  failSecondPage = true;
  worker = await startGmailWorker({
    databaseUrl,
    gmail: {
      clientId: "client",
      clientSecret: "secret",
      tokenKey: "b".repeat(64),
      tokenEndpoint: endpoint() + "/token",
      apiEndpoint: endpoint(),
    },
    publicUrl: "https://haiji.example",
    clock: () => new Date(clock + Date.now() - wallStart),
  });
  await until(async () => !!(await call("/v1/gmail")).body.syncError);
  expect(
    (await call("/v1/gmail/items")).body.items.map(
      (i: { messageId: string }) => i.messageId,
    ),
  ).toEqual(["mail-1"]);
  expect((await call("/v1/gmail")).body.lastSuccessfulSync).toBeNull();
  clock += 120000;
  await until(async () => !!(await call("/v1/gmail")).body.lastSuccessfulSync);
  expect((await call("/v1/gmail/items")).body.items).toHaveLength(2);
  expect(bodyRequests).not.toContain("old");
  expect(bodyRequests).not.toContain("excluded");
  expect((await call("/v1/gmail")).body.syncError).toBeNull();
}, 15000);
test("expired history rebuilds the same window and label scope, then reports credential failure separately from last success", async () => {
  expireHistory = true;
  clock += 360000;
  await until(
    async () =>
      new Date((await call("/v1/gmail")).body.lastSuccessfulSync).getTime() >=
      clock,
  );
  expect((await call("/v1/gmail/items")).body.items).toHaveLength(2);
  expect(bodyRequests).not.toContain("old");
  expect(bodyRequests).not.toContain("excluded");
  credentialInvalid = true;
  clock += 360000;
  await until(
    async () =>
      (await call("/v1/gmail")).body.state === "reauthorization_required",
  );
  expect((await call("/v1/gmail")).body).toMatchObject({
    syncError: "REAUTH_REQUIRED",
    lastSuccessfulSync: expect.any(String),
  });
  expect(
    (await call("/v1/gmail/refresh", "POST", { expectedRevision: 1 })).status,
  ).toBe(409);
  credentialInvalid = false;
}, 15000);
test("reauthorization with new-only scope does not read historical bodies, and stop fences an in-flight body", async () => {
  const start = await call("/v1/gmail/connect", "POST", {
    labelIds: ["INBOX"],
    initialDays: 0,
    retentionDays: 1,
    confirmed: true,
    expectedRevision: 1,
  });
  expect(start.status).toBe(200);
  const state = new URL(start.body.authorizationUrl).searchParams.get("state");
  expect(
    (
      await fetch(
        base + "/v1/gmail/oauth/callback?state=" + state + "&code=secret-code",
        { redirect: "manual" },
      )
    ).status,
  ).toBe(303);
  const count = bodyRequests.length;
  await until(async () => !!(await call("/v1/gmail")).body.lastSuccessfulSync);
  await new Promise((r) => setTimeout(r, 700));
  expect(bodyRequests.length).toBe(count);
  // Reconfirm 7-day expansion, force a read in flight, then revoke it through the owner API.
  clock += 30000;
  const expand = await call("/v1/gmail/connect", "POST", {
    labelIds: ["INBOX"],
    initialDays: 7,
    retentionDays: 1,
    confirmed: true,
    expectedRevision: 2,
  });
  gateBody = true;
  await fetch(
    base +
      "/v1/gmail/oauth/callback?state=" +
      new URL(expand.body.authorizationUrl).searchParams.get("state") +
      "&code=secret-code",
    { redirect: "manual" },
  );
  await until(async () => !!releaseBody);
  const stopKey = randomUUID();
  expect(
    (
      await call(
        "/v1/gmail/stop",
        "POST",
        { expectedRevision: 3 },
        token,
        stopKey,
      )
    ).status,
  ).toBe(200);
  gateBody = false;
  releaseBody!();
  releaseBody = undefined;
  expect(
    (
      await call(
        "/v1/gmail/stop",
        "POST",
        { expectedRevision: 3 },
        token,
        stopKey,
      )
    ).status,
  ).toBe(200);
  await new Promise((r) => setTimeout(r, 800));
  expect((await call("/v1/gmail")).body).toMatchObject({
    state: "stopped",
    revision: 4,
  });
  expect((await call("/v1/gmail/items")).body.items).toEqual([]);
}, 15000);

test("unconfirmed ranges and stale revisions are rejected, and a revoked pairing invalidates its pending OAuth callback", async () => {
  const consent = {
    labelIds: ["INBOX"],
    initialDays: 7,
    retentionDays: 7,
    confirmed: true,
    expectedRevision: 4,
  };
  expect(
    (await call("/v1/gmail/connect", "POST", { ...consent, confirmed: false }))
      .status,
  ).toBe(422);
  expect(
    (await call("/v1/gmail/connect", "POST", { ...consent, labelIds: [] }))
      .status,
  ).toBe(422);
  expect(
    (
      await call("/v1/gmail/connect", "POST", {
        ...consent,
        expectedRevision: 1,
      })
    ).status,
  ).toBe(409);
  const start = await call("/v1/gmail/connect", "POST", consent);
  expect(start.status).toBe(200);
  expect((await call("/v1/session", "DELETE")).status).toBe(200);
  const callback = await fetch(
    base +
      "/v1/gmail/oauth/callback?state=" +
      new URL(start.body.authorizationUrl).searchParams.get("state") +
      "&code=secret-code",
    { redirect: "manual" },
  );
  expect(callback.status).toBe(401);
  const pairing = await call("/v1/admin/pairings", "POST", {}, "a".repeat(48));
  token = (
    await call(
      "/v1/pairings/claim",
      "POST",
      { code: pairing.body.code, deviceName: "Replacement" },
      "",
    )
  ).body.accessToken;
  expect((await call("/v1/gmail")).body).toMatchObject({
    state: "stopped",
    revision: 4,
  });
  expect(logs).not.toContain("secret-refresh");
  expect(logs).not.toContain("secret-access");
  expect(logs).not.toContain("secret-code");
});

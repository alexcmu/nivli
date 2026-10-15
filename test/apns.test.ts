import { test, expect } from "vitest";
import { createServer, connect } from "node:http2";
import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { once } from "node:events";
import { createApnsSender, readApnsConfig } from "../src/apns.js";

test("APNs config requires complete matching identity and readable P-256 key", async () => {
  expect(await readApnsConfig({})).toBeUndefined();
  await expect(readApnsConfig({ APNS_TEAM_ID: "ABCDEFGHIJ" })).rejects.toThrow(
    "APNs requires",
  );
  await expect(
    readApnsConfig({
      APNS_TEAM_ID: "ABCDEFGHIJ",
      APNS_KEY_ID: "ABCDEFGHIJ",
      APNS_TOPIC: "app.haiji.Haiji",
      APNS_ENVIRONMENT: "sandbox",
      APNS_KEY_FILE: "/nonexistent",
    }),
  ).rejects.toThrow("development or production");
  await expect(
    readApnsConfig({
      APNS_TEAM_ID: "ABCDEFGHIJ",
      APNS_KEY_ID: "ABCDEFGHIJ",
      APNS_TOPIC: "app.haiji.Haiji",
      APNS_ENVIRONMENT: "development",
      APNS_KEY_FILE: "/nonexistent",
    }),
  ).rejects.toThrow("readable APNs P-256");
});
test("actual HTTP/2 adapter signs ES256, caches JWT and interprets accepted, retryable, invalid token and transport failure", async () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const server = createServer();
  let response = { status: 200, reason: "", timestamp: 0 },
    abort = false;
  const headers: Record<string, unknown>[] = [],
    bodies: string[] = [];
  server.on("stream", (stream, incoming) => {
    headers.push(incoming);
    let body = "";
    stream.on("data", (chunk) => (body += chunk.toString()));
    stream.on("end", () => {
      bodies.push(body);
      if (abort) {
        stream.close(2);
        return;
      }
      stream.respond({ ":status": response.status });
      stream.end(
        response.status === 200
          ? ""
          : JSON.stringify({
              reason: response.reason,
              timestamp: response.timestamp,
            }),
      );
    });
    stream.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const authorities: string[] = [];
  const sender = createApnsSender(
    {
      topic: "app.haiji.Haiji",
      environment: "development",
      teamId: "ABCDEFGHIJ",
      keyId: "0123456789",
      key: keys.privateKey,
    },
    (authority) => {
      authorities.push(authority);
      return connect("http://127.0.0.1:" + address.port);
    },
  );
  const request = {
    token: "ab".repeat(32),
    id: randomUUID(),
    expiration: new Date(Date.now() + 60000),
    payload: {
      aps: { alert: { title: "Haiji 提醒", body: "有一件事需要你查看。" } },
    },
  };
  try {
    expect(await sender(request)).toEqual({ status: "accepted" });
    response = { status: 429, reason: "TooManyRequests", timestamp: 0 };
    expect(await sender(request)).toMatchObject({
      status: "rejected",
      retryable: true,
      invalidToken: false,
    });
    response = { status: 403, reason: "InvalidProviderToken", timestamp: 0 };
    expect(await sender(request)).toMatchObject({
      status: "rejected",
      retryable: false,
      reason: "InvalidProviderToken",
    });
    response = {
      status: 410,
      reason: "Unregistered",
      timestamp: Date.now() - 1000,
    };
    expect(await sender(request)).toMatchObject({
      status: "rejected",
      invalidToken: true,
      invalidatedAt: response.timestamp,
    });
    abort = true;
    expect(await sender(request)).toEqual({ status: "unknown" });
    expect(
      authorities.every(
        (value) => value === "https://api.sandbox.push.apple.com",
      ),
    ).toBe(true);
    expect(headers[0]).toMatchObject({
      ":method": "POST",
      ":path": "/3/device/" + request.token,
      "apns-topic": "app.haiji.Haiji",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-id": request.id,
      "apns-expiration": String(
        Math.floor(request.expiration.getTime() / 1000),
      ),
    });
    expect(JSON.parse(bodies[0]!)).toEqual(request.payload);
    const jwt = String(headers[0]!.authorization).slice(7),
      [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "0123456789",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss).toBe(
      "ABCDEFGHIJ",
    );
    expect(
      verify(
        "sha256",
        Buffer.from(header + "." + claims),
        { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(headers[1]!.authorization).toBe(headers[0]!.authorization);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("managed hosting accepts a private environment key, rejects ambiguous sources and redacts invalid secrets", async () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const env = {
    APNS_TEAM_ID: "ABCDEFGHIJ",
    APNS_KEY_ID: "0123456789",
    APNS_TOPIC: "app.haiji.Haiji",
    APNS_ENVIRONMENT: "development",
    APNS_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
  const config = await readApnsConfig(env);
  expect(config?.key.asymmetricKeyType).toBe("ec");
  await expect(
    readApnsConfig({ ...env, APNS_KEY_FILE: "/unused" }),
  ).rejects.toThrow("only one APNs key source");
  await expect(
    readApnsConfig({ ...env, APNS_PRIVATE_KEY: "synthetic-private-secret" }),
  ).rejects.toThrow(
    "APNS_PRIVATE_KEY must contain a valid APNs P-256 private key",
  );
});

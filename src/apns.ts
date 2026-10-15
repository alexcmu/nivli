import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect, type ClientHttp2Session } from "node:http2";

export type ApnsIdentity = {
  topic: string;
  environment: "development" | "production";
};
export type ApnsConfig = ApnsIdentity & {
  teamId: string;
  keyId: string;
  key: KeyObject;
};
export type PushRequest = {
  token: string;
  id: string;
  expiration: Date;
  payload: Record<string, unknown>;
};
export type PushResult =
  | { status: "accepted" }
  | { status: "unknown" }
  | {
      status: "rejected";
      reason: string;
      retryable: boolean;
      invalidToken: boolean;
      invalidatedAt?: number;
    };
export type PushSender = (request: PushRequest) => Promise<PushResult>;
export async function readApnsConfig(
  env = process.env,
): Promise<ApnsConfig | undefined> {
  const fields = [
    env.APNS_TEAM_ID,
    env.APNS_KEY_ID,
    env.APNS_TOPIC,
    env.APNS_ENVIRONMENT,
    env.APNS_KEY_FILE || env.APNS_PRIVATE_KEY,
  ];
  if (fields.every((v) => !v)) return;
  if (fields.some((v) => !v))
    throw new Error(
      "APNs requires APNS_TEAM_ID, APNS_KEY_ID, APNS_TOPIC, APNS_ENVIRONMENT and APNS_KEY_FILE or APNS_PRIVATE_KEY",
    );
  if (
    !/^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID!) ||
    !/^[A-Z0-9]{10}$/.test(env.APNS_KEY_ID!)
  )
    throw new Error(
      "APNs Team ID and Key ID must be 10 uppercase letters/digits",
    );
  if (!/^[A-Za-z0-9.-]{3,200}$/.test(env.APNS_TOPIC!))
    throw new Error("APNS_TOPIC must match the signed app Bundle ID");
  if (
    env.APNS_ENVIRONMENT !== "development" &&
    env.APNS_ENVIRONMENT !== "production"
  )
    throw new Error("APNS_ENVIRONMENT must be development or production");
  if (env.APNS_KEY_FILE && env.APNS_PRIVATE_KEY)
    throw new Error(
      "Configure only one APNs key source: APNS_KEY_FILE or APNS_PRIVATE_KEY",
    );
  let key: KeyObject;
  try {
    key = createPrivateKey(
      env.APNS_PRIVATE_KEY ?? (await readFile(env.APNS_KEY_FILE!, "utf8")),
    );
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error();
  } catch {
    throw new Error(
      env.APNS_PRIVATE_KEY
        ? "APNS_PRIVATE_KEY must contain a valid APNs P-256 private key"
        : "APNS_KEY_FILE must be a readable APNs P-256 private key (.p8)",
    );
  }
  return {
    topic: env.APNS_TOPIC!,
    environment: env.APNS_ENVIRONMENT,
    teamId: env.APNS_TEAM_ID!,
    keyId: env.APNS_KEY_ID!,
    key,
  };
}
export function createApnsSender(
  config: ApnsConfig,
  openConnection: (authority: string) => ClientHttp2Session = connect,
): PushSender {
  let cached: { issued: number; jwt: string } | undefined;
  return async (request) => {
    const issued = Math.floor(Date.now() / 1000);
    if (!cached || issued - cached.issued >= 3000) {
      const header = Buffer.from(
        JSON.stringify({ alg: "ES256", kid: config.keyId }),
      ).toString("base64url");
      const claims = Buffer.from(
        JSON.stringify({ iss: config.teamId, iat: issued }),
      ).toString("base64url");
      const content = header + "." + claims;
      cached = {
        issued,
        jwt:
          content +
          "." +
          sign("sha256", Buffer.from(content), {
            key: config.key,
            dsaEncoding: "ieee-p1363",
          }).toString("base64url"),
      };
    }
    const jwt = cached.jwt;
    return new Promise<PushResult>((resolve) => {
      const client = openConnection(
        config.environment === "development"
          ? "https://api.sandbox.push.apple.com"
          : "https://api.push.apple.com",
      );
      let finished = false;
      const done = (result: PushResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        client.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => done({ status: "unknown" }), 10000);
      client.on("error", () => done({ status: "unknown" }));
      client.on("goaway", () => done({ status: "unknown" }));
      const stream = client.request({
        ":method": "POST",
        ":path": "/3/device/" + request.token,
        authorization: "bearer " + jwt,
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-id": request.id,
        "apns-expiration": String(
          Math.floor(request.expiration.getTime() / 1000),
        ),
        "content-type": "application/json",
      });
      let status = 0,
        body = "";
      stream.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      stream.on("data", (chunk) => {
        body += chunk.toString();
        if (body.length > 4096) done({ status: "unknown" });
      });
      stream.on("error", () => done({ status: "unknown" }));
      stream.on("end", () => {
        if (status === 200) return done({ status: "accepted" });
        let response: { reason?: string; timestamp?: number } = {};
        try {
          const parsed: unknown = JSON.parse(body);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !("reason" in parsed) ||
            typeof parsed.reason !== "string"
          )
            return done({ status: "unknown" });
          response = {
            reason: parsed.reason,
            ...("timestamp" in parsed && typeof parsed.timestamp === "number"
              ? { timestamp: parsed.timestamp }
              : {}),
          };
        } catch {
          return done({ status: "unknown" });
        }
        // Keep provider output on a fixed allowlist; never persist arbitrary text.
        const allowed = [
          "BadDeviceToken",
          "DeviceTokenNotForTopic",
          "Unregistered",
          "TooManyRequests",
          "InternalServerError",
          "ServiceUnavailable",
          "Shutdown",
          "ExpiredProviderToken",
          "InvalidProviderToken",
          "Forbidden",
          "BadTopic",
          "TopicDisallowed",
          "BadEnvironmentKeyIdInToken",
          "ExpiredToken",
          "BadPriority",
          "BadPayload",
          "PayloadTooLarge",
        ];
        const reason = allowed.includes(response.reason ?? "")
          ? response.reason!
          : "ProviderRejected";
        const retryable =
          (status === 429 && reason === "TooManyRequests") ||
          status === 500 ||
          status === 503;
        done({
          status: "rejected",
          reason,
          retryable,
          invalidToken: [
            "BadDeviceToken",
            "DeviceTokenNotForTopic",
            "Unregistered",
          ].includes(reason),
          ...(status === 410 && Number.isFinite(response.timestamp)
            ? { invalidatedAt: response.timestamp }
            : {}),
        });
      });
      stream.end(JSON.stringify(request.payload));
    });
  };
}

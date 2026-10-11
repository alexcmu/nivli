import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  apiEndpoint?: string;
}
export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
}
export class GmailFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
  }
}
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function tokenVault(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error(
      "GMAIL_TOKEN_KEY must be independent 32-byte hexadecimal secret",
    );
  const bytes = Buffer.from(key, "hex");
  return {
    seal(value: unknown) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", bytes, iv);
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    },
    open<T>(value: string): T {
      const data = Buffer.from(value, "base64");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        bytes,
        data.subarray(0, 12),
      );
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString(),
      );
    },
  };
}
export class GmailProvider {
  constructor(
    readonly config: GmailConfig,
    readonly redirectUri: string,
  ) {}
  authorization(state: string) {
    const u = new URL(
      this.config.authorizationEndpoint ??
        "https://accounts.google.com/o/oauth2/v2/auth",
    );
    u.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: gmailScope,
      state,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    return u.toString();
  }
  async tokens(
    params: Record<string, string>,
    previous?: GmailTokens,
    signal?: AbortSignal,
  ): Promise<GmailTokens> {
    const r = await fetch(
      this.config.tokenEndpoint ?? "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...params,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      },
    );
    const body = (await r.json()) as {
      error?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!r.ok)
      throw new GmailFailure(
        body.error === "invalid_grant"
          ? "REAUTH_REQUIRED"
          : "PROVIDER_UNAVAILABLE",
        body.error === "invalid_grant" ? 401 : 503,
      );
    if (
      !body.access_token ||
      (!body.refresh_token && !previous?.refresh_token) ||
      body.scope?.split(" ").some((s) => s !== gmailScope)
    )
      throw new GmailFailure("REAUTH_REQUIRED", 401);
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? previous!.refresh_token,
      expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope,
    };
  }
  exchange(code: string) {
    return this.tokens({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });
  }
  refresh(tokens: GmailTokens, signal?: AbortSignal) {
    return this.tokens(
      { grant_type: "refresh_token", refresh_token: tokens.refresh_token },
      tokens,
      signal,
    );
  }
  async get<T>(
    tokens: GmailTokens,
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const u = new URL(
      (this.config.apiEndpoint ?? "https://gmail.googleapis.com/gmail/v1") +
        "/users/me/" +
        path,
    );
    u.search = new URLSearchParams(params).toString();
    const r = await fetch(u, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw new GmailFailure(
        r.status === 401
          ? "REAUTH_REQUIRED"
          : r.status === 404
            ? "NOT_FOUND"
            : "PROVIDER_UNAVAILABLE",
        r.status,
      );
    return (await r.json()) as T;
  }
}
export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  payload?: {
    mimeType?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
}
export function messageContent(message: GmailMessage) {
  const fields = new Set(["subject", "from", "to", "date"]);
  const headers =
    message.payload?.headers?.filter((h) => fields.has(h.name.toLowerCase())) ??
    [];
  const text = (p: GmailMessage["payload"]): string =>
    !p
      ? ""
      : p.mimeType === "text/plain"
        ? Buffer.from(p.body?.data ?? "", "base64url")
            .toString("utf8")
            .slice(0, 12000)
        : (p.parts ?? []).map(text).join("\n").slice(0, 12000);
  return { threadId: message.threadId, headers, body: text(message.payload) };
}

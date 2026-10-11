import pg from "pg";
import { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import {
  GmailProvider,
  GmailFailure,
  tokenVault,
  digest,
  messageContent,
  type GmailConfig,
  type GmailTokens,
  type GmailMessage,
} from "./gmail.js";
interface Scan {
  mode: "full" | "history";
  baseline: string;
  page?: string;
  pages: number;
}
interface Source {
  owner_id: string;
  account: string;
  revision: number;
  label_ids: string[];
  authorized_after: Date;
  retention_days: number;
  encrypted_tokens: string;
  history_id: string | null;
  scan: Scan | null;
  failures: number;
}
export interface GmailWorkerConfig {
  databaseUrl: string;
  gmail: GmailConfig;
  publicUrl: string;
  clock?: () => Date;
}
export async function startGmailWorker(config: GmailWorkerConfig) {
  const vault = tokenVault(config.gmail.tokenKey);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    migrate: false,
  });
  boss.on("error", () => console.error("Mailbox queue unavailable"));
  await boss.start();
  await boss.createQueue("mailbox");
  const provider = new GmailProvider(
      config.gmail,
      config.publicUrl + "/v1/gmail/oauth/callback",
    ),
    now = () => config.clock?.() ?? new Date();
  let stopping = false;
  async function synchronize(owner: string, revision: number) {
    // A bounded lease prevents concurrent reads; every write still checks the authorization revision.
    const claimed = await pool.query<Source>(
      `UPDATE gmail_source SET lease_until=$3 WHERE owner_id=$1 AND revision=$2 AND state='active' AND next_sync_at<=$4 AND (lease_until IS NULL OR lease_until<$4) AND EXISTS(SELECT 1 FROM device WHERE owner_id=$1 AND revoked_at IS NULL) RETURNING *`,
      [owner, revision, new Date(now().getTime() + 180000), now()],
    );
    if (!claimed.rowCount) return;
    const source = claimed.rows[0]!;
    try {
      const pageSignal = AbortSignal.timeout(150000);
      let tokens = vault.open<GmailTokens>(source.encrypted_tokens);
      if (tokens.expires_at <= Date.now() + 30000)
        tokens = await provider.refresh(tokens, pageSignal);
      const read = <T>(path: string, params: Record<string, string> = {}) =>
        provider.get<T>(tokens, path, params, pageSignal);
      let scan = source.scan;
      if (!scan) {
        scan = source.history_id
          ? { mode: "history", baseline: source.history_id, pages: 0 }
          : {
              mode: "full",
              baseline: (await read<{ historyId: string }>("profile"))
                .historyId,
              pages: 0,
            };
      }
      let ids: string[] = [],
        next: string | undefined,
        completedHistory = scan.baseline;
      if (scan.mode === "full") {
        const page = await read<{
          messages?: { id: string }[];
          nextPageToken?: string;
        }>("messages", {
          q: `after:${Math.floor(source.authorized_after.getTime() / 1000)}`,
          maxResults: "30",
          ...(scan.page ? { pageToken: scan.page } : {}),
        });
        ids = (page.messages ?? []).map((m) => m.id);
        next = page.nextPageToken;
      } else {
        try {
          const page = await read<{
            history?: {
              messagesAdded?: { message: { id: string } }[];
              labelsAdded?: { message: { id: string } }[];
              labelsRemoved?: { message: { id: string } }[];
              messagesDeleted?: { message: { id: string } }[];
            }[];
            historyId: string;
            nextPageToken?: string;
          }>("history", {
            startHistoryId: scan.baseline,
            maxResults: "30",
            ...(scan.page ? { pageToken: scan.page } : {}),
          });
          ids = (page.history ?? []).flatMap((h) =>
            [
              ...(h.messagesAdded ?? []),
              ...(h.labelsAdded ?? []),
              ...(h.labelsRemoved ?? []),
            ].map((m) => m.message.id),
          );
          next = page.nextPageToken;
          completedHistory = page.historyId;
        } catch (e) {
          if (e instanceof GmailFailure && e.status === 404) {
            // History expiration rebuilds from the SAME authorized time and labels. Baseline is captured before listing.
            scan = {
              mode: "full",
              baseline: (await read<{ historyId: string }>("profile"))
                .historyId,
              pages: 0,
            };
            const page = await read<{
              messages?: { id: string }[];
              nextPageToken?: string;
            }>("messages", {
              q: `after:${Math.floor(source.authorized_after.getTime() / 1000)}`,
              maxResults: "30",
            });
            ids = (page.messages ?? []).map((m) => m.id);
            next = page.nextPageToken;
            completedHistory = scan.baseline;
          } else throw e;
        }
      }
      if (scan.pages >= 200) throw new GmailFailure("WINDOW_LIMIT_REACHED");
      const items: {
        message: GmailMessage;
        content: ReturnType<typeof messageContent>;
        version: string;
      }[] = [];
      for (const id of new Set(ids)) {
        // Recheck before each provider read so stopped sources do not continue another page/body.
        const active = await pool.query(
          "SELECT owner_id FROM gmail_source WHERE owner_id=$1 AND revision=$2 AND state='active' AND EXISTS(SELECT 1 FROM device WHERE owner_id=$1 AND revoked_at IS NULL)",
          [owner, revision],
        );
        if (!active.rowCount) return;
        let metadata: GmailMessage;
        try {
          metadata = await read<GmailMessage>(
            "messages/" + encodeURIComponent(id),
            { format: "metadata", fields: "id,threadId,internalDate,labelIds" },
          );
        } catch (e) {
          if (e instanceof GmailFailure && e.status === 404) continue;
          throw e;
        }
        if (
          Number(metadata.internalDate) < source.authorized_after.getTime() ||
          !metadata.labelIds?.some((label) => source.label_ids.includes(label))
        )
          continue;
        const message = await read<GmailMessage>(
          "messages/" + encodeURIComponent(id),
          { format: "full" },
        );
        // Labels/time may have changed between metadata and full; discard before persistence.
        if (
          Number(message.internalDate) < source.authorized_after.getTime() ||
          !message.labelIds?.some((label) => source.label_ids.includes(label))
        )
          continue;
        const content = messageContent(message);
        items.push({
          message,
          content,
          version: digest(JSON.stringify(content)),
        });
      }
      pageSignal.throwIfAborted();
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [owner]);
        const active = await tx.query(
          "SELECT owner_id FROM gmail_source WHERE owner_id=$1 AND revision=$2 AND state='active' AND EXISTS(SELECT 1 FROM device WHERE owner_id=$1 AND revoked_at IS NULL) FOR UPDATE",
          [owner, revision],
        );
        if (!active.rowCount) {
          await tx.query("ROLLBACK");
          return;
        }
        for (const item of items) {
          const id = randomUUID();
          const expires = new Date(
            now().getTime() + source.retention_days * 86400000,
          );
          const r = await tx.query(
            `INSERT INTO gmail_source_item(id,owner_id,account,message_id,content_version,authorization_revision,received_at,expires_at,encrypted_content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,account,message_id,content_version) DO UPDATE SET authorization_revision=excluded.authorization_revision,encrypted_content=CASE WHEN gmail_source_item.expires_at>now() THEN excluded.encrypted_content ELSE NULL END RETURNING id`,
            [
              id,
              owner,
              source.account,
              item.message.id,
              item.version,
              revision,
              new Date(Number(item.message.internalDate)),
              expires,
              vault.seal(item.content),
            ],
          );
          // Ticket 18 may consume these events; this worker neither calls a model nor creates formal tasks.
          await tx.query(
            "INSERT INTO gmail_event(id,owner_id,source_item_id,authorization_revision) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [randomUUID(), owner, r.rows[0].id, revision],
          );
        }
        await tx.query(
          `UPDATE gmail_source SET encrypted_tokens=$3,scan=$4,history_id=CASE WHEN $5 THEN $6 ELSE history_id END,last_successful_sync=CASE WHEN $5 THEN $7 ELSE last_successful_sync END,sync_error=NULL,failures=0,next_sync_at=$8,lease_until=NULL WHERE owner_id=$1 AND revision=$2`,
          [
            owner,
            revision,
            vault.seal(tokens),
            next
              ? JSON.stringify({ ...scan, page: next, pages: scan.pages + 1 })
              : null,
            !next,
            completedHistory,
            now(),
            new Date(
              now().getTime() +
                (next ? 1000 : 270000 + Math.floor(Math.random() * 60000)),
            ),
          ],
        );
        await tx.query("COMMIT");
      } catch (e) {
        await tx.query("ROLLBACK");
        throw e;
      } finally {
        tx.release();
      }
    } catch (e) {
      const reauth = e instanceof GmailFailure && e.code === "REAUTH_REQUIRED";
      const code = reauth
        ? "REAUTH_REQUIRED"
        : e instanceof GmailFailure && e.code === "WINDOW_LIMIT_REACHED"
          ? "WINDOW_LIMIT_REACHED"
          : "SYNC_TEMPORARILY_UNAVAILABLE";
      await pool.query(
        `UPDATE gmail_source SET state=CASE WHEN $3 THEN 'reauthorization_required' ELSE state END,sync_error=$4,failures=failures+1,lease_until=NULL,next_sync_at=CASE WHEN $3 THEN NULL ELSE $5::timestamptz END WHERE owner_id=$1 AND revision=$2 AND state='active'`,
        [
          owner,
          revision,
          reauth,
          code,
          new Date(
            now().getTime() +
              Math.min(3600000, 60000 * 2 ** Math.min(source.failures, 6)) +
              Math.floor(Math.random() * 30000),
          ),
        ],
      );
    }
  }
  await boss.work<{ ownerId: string; revision: number }>(
    "mailbox",
    { pollingIntervalSeconds: 0.5, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs)
        await synchronize(job.data.ownerId, job.data.revision);
    },
  );
  let tickRunning = false;
  const tick = async () => {
    if (stopping || tickRunning) return;
    tickRunning = true;
    try {
      // TTL removes cached original bodies; minimum dedup identities/events remain for downstream suppression.
      await pool.query(
        "UPDATE gmail_source_item SET encrypted_content=NULL WHERE expires_at<$1 AND encrypted_content IS NOT NULL",
        [now()],
      );
      const r = await pool.query(
        "SELECT owner_id,revision FROM gmail_source WHERE state='active' AND next_sync_at<=$1 AND (lease_until IS NULL OR lease_until<$1)",
        [now()],
      );
      for (const source of r.rows)
        await boss.send(
          "mailbox",
          { ownerId: source.owner_id, revision: source.revision },
          {
            singletonKey: source.owner_id + ":" + source.revision,
            singletonSeconds: 1,
            retryLimit: 3,
            expireInSeconds: 180,
          },
        );
    } catch {
      console.error("Mailbox scheduler unavailable");
    } finally {
      tickRunning = false;
    }
  };
  await tick();
  const interval = setInterval(() => void tick(), 1000);
  return {
    async stop() {
      stopping = true;
      clearInterval(interval);
      await boss.stop({ graceful: true });
      await pool.end();
    },
  };
}

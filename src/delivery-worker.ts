import pg from "pg";
import { PgBoss } from "pg-boss";
import type { ApnsIdentity, PushSender, PushResult } from "./apns.js";

export async function startDeliveryWorker(config: {
  databaseUrl: string;
  apns?: ApnsIdentity;
  send?: PushSender;
  clock?: () => Date;
  scanIntervalMs?: number;
  windowHours?: number;
}) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    migrate: false,
  });
  const now = () => config.clock?.() ?? new Date();
  let scanning = false,
    stopped = false;
  const intervalMs = config.scanIntervalMs ?? 60000,
    windowHours = config.windowHours ?? 24;
  if (
    !Number.isFinite(intervalMs) ||
    intervalMs < 100 ||
    !Number.isFinite(windowHours) ||
    windowHours <= 0 ||
    windowHours > 168
  )
    throw new Error("Invalid delivery scan interval or materialization window");
  boss.on("error", () => console.error("Delivery queue unavailable"));
  await boss.start();
  await boss.createQueue("remote-delivery", {
    policy: "exclusive",
    retentionSeconds: 7 * 86400,
    deleteAfterSeconds: 7 * 86400,
  });
  async function enqueue(row: {
    id: string;
    reminder_revision: number;
    attempt: number;
    next_attempt_at: Date | string;
  }) {
    await boss.send(
      "remote-delivery",
      {
        occurrenceId: row.id,
        reminderRevision: row.reminder_revision,
        attempt: row.attempt,
      },
      {
        singletonKey: row.id + ":" + row.attempt,
        startAfter: new Date(row.next_attempt_at),
        retryLimit: 0,
        expireInSeconds: 60,
        retentionSeconds: 7 * 86400,
        deleteAfterSeconds: 7 * 86400,
      },
    );
  }
  async function processOccurrence(
    id: string,
    revision: number,
    attempt: number,
  ) {
    const c = await pool.connect();
    let claimed: Record<string, any> | undefined;
    try {
      await c.query("BEGIN");
      const owner = (
        await c.query("SELECT owner_id FROM remote_occurrence WHERE id=$1", [
          id,
        ])
      ).rows[0];
      if (!owner) {
        await c.query("COMMIT");
        return;
      }
      // Same lock as task commands, token changes and device revocation.
      await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
        owner.owner_id,
      ]);
      const row = (
        await c.query(
          `SELECT o.*,r.active,r.revision AS current_revision,t.status AS task_status,t.id AS task_id,d.revoked_at,
 p.token,p.enabled,p.authorized,p.invalidated_at,p.topic,p.environment,p.registered_at
 FROM remote_occurrence o JOIN reminder r ON r.owner_id=o.owner_id AND r.id=o.reminder_id
 JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id JOIN device d ON d.owner_id=o.owner_id AND d.id=o.device_id
 LEFT JOIN push_registration p ON p.owner_id=o.owner_id AND p.device_id=o.device_id WHERE o.id=$1 FOR UPDATE OF o`,
          [id],
        )
      ).rows[0];
      const time = now();
      if (
        !row ||
        row.status !== "planned" ||
        row.reminder_revision !== revision ||
        row.attempt !== attempt
      ) {
        await c.query("COMMIT");
        return;
      }
      if (
        !row.active ||
        row.current_revision !== revision ||
        row.task_status !== "active" ||
        row.revoked_at ||
        row.delivery_owner !== "server"
      ) {
        await c.query(
          "UPDATE remote_occurrence SET status='cancelled' WHERE id=$1",
          [id],
        );
      } else if (new Date(row.expires_at) <= time) {
        await c.query(
          "UPDATE remote_occurrence SET status='expired' WHERE id=$1",
          [id],
        );
      } else if (
        config.send &&
        config.apns &&
        row.enabled &&
        row.authorized &&
        !row.invalidated_at &&
        row.topic === config.apns.topic &&
        row.environment === config.apns.environment &&
        row.quiet_hours_confirmed &&
        new Date(row.next_attempt_at) <= time &&
        new Date(row.scheduled_at) <= time
      ) {
        await c.query(
          "UPDATE remote_occurrence SET status='sending',attempt=attempt+1,lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
          [id],
        );
        claimed = { ...row, attempt: row.attempt + 1 };
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    if (!claimed) return;
    const o = claimed;
    // Namespace is constructed on-device from authenticated owner/device, never trusted as routing authority.
    const payload = {
      aps: {
        alert: { title: "Haiji 提醒", body: "有一件事需要你查看。" },
        sound: "default",
        category: "HAIJI_REMOTE_TASK",
        "interruption-level": "active",
      },
      requestId: "haiji.remote." + o.id + ".1",
      taskId: o.task_id,
      ownerId: o.owner_id,
      deviceId: o.device_id,
      occurrenceId: o.id,
      reminderRevision: o.reminder_revision,
      routingVersion: o.routing_version,
    };
    let result: PushResult;
    try {
      result = await config.send!({
        token: o.token,
        id: o.id,
        expiration: new Date(o.expires_at),
        payload,
      });
    } catch {
      result = { status: "unknown" };
    }
    let retryAt: Date | undefined;
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
        o.owner_id,
      ]);
      const locked = (
        await connection.query(
          "SELECT status,attempt FROM remote_occurrence WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (locked?.status !== "sending" || locked.attempt !== o.attempt) {
        await connection.query("COMMIT");
        return;
      }
      if (result.status === "accepted") {
        await connection.query(
          "UPDATE remote_occurrence SET status='accepted',accepted_at=$2,lease_expires_at=NULL,last_error=NULL WHERE id=$1",
          [id, now()],
        );
      } else if (result.status === "unknown") {
        await connection.query(
          "UPDATE remote_occurrence SET status='unknown',lease_expires_at=NULL,last_error='TransportUnknown' WHERE id=$1",
          [id],
        );
      } else {
        if (result.invalidToken)
          await connection.query(
            "UPDATE push_registration SET invalidated_at=$4 WHERE owner_id=$1 AND device_id=$2 AND token=$3 AND registered_at <= $4",
            [
              o.owner_id,
              o.device_id,
              o.token,
              result.invalidatedAt
                ? new Date(result.invalidatedAt)
                : new Date(o.registered_at),
            ],
          );
        const delay = [5000, 30000, 120000][o.attempt - 1];
        const next =
          delay === undefined ? undefined : new Date(now().getTime() + delay);
        const retry = result.retryable && next && next < new Date(o.expires_at);
        if (retry) retryAt = next;
        await connection.query(
          "UPDATE remote_occurrence SET status=$2,next_attempt_at=coalesce($3,next_attempt_at),lease_expires_at=NULL,last_error=$4 WHERE id=$1",
          [
            id,
            retry ? "planned" : "failed",
            retry ? next : null,
            result.reason,
          ],
        );
      }
      await connection.query("COMMIT");
    } catch (e) {
      await connection.query("ROLLBACK");
      throw e;
    } finally {
      connection.release();
    }
    if (retryAt)
      await enqueue({
        id,
        reminder_revision: revision,
        attempt: o.attempt,
        next_attempt_at: retryAt,
      });
  }
  await boss.work<{
    occurrenceId: string;
    reminderRevision: number;
    attempt: number;
  }>("remote-delivery", { pollingIntervalSeconds: 0.5 }, async (jobs) => {
    for (const job of jobs)
      await processOccurrence(
        job.data.occurrenceId,
        job.data.reminderRevision,
        job.data.attempt,
      );
  });
  async function scan() {
    if (scanning || stopped) return;
    scanning = true;
    try {
      // A lost network result is never turned back into permission to send.
      await pool.query(
        "UPDATE remote_occurrence SET status='unknown',last_error='WorkerResultUnknown',lease_expires_at=NULL WHERE status='sending' AND lease_expires_at<clock_timestamp()",
      );
      await pool.query(
        "UPDATE remote_occurrence SET status='expired' WHERE status='planned' AND expires_at<=$1",
        [now()],
      );
      await pool.query(
        `UPDATE remote_occurrence o SET status='cancelled' FROM reminder r JOIN task t ON t.owner_id=r.owner_id AND t.id=r.task_id WHERE o.reminder_id=r.id AND o.owner_id=r.owner_id AND o.status='planned' AND (NOT r.active OR r.revision<>o.reminder_revision OR t.status<>'active' OR EXISTS(SELECT 1 FROM device d WHERE d.owner_id=o.owner_id AND d.id=o.device_id AND d.revoked_at IS NOT NULL))`,
      );
      const rows = (
        await pool.query(
          "SELECT id,reminder_revision,attempt,next_attempt_at FROM remote_occurrence WHERE status='planned' AND quiet_hours_confirmed AND next_attempt_at<$1 ORDER BY next_attempt_at LIMIT 1000",
          [new Date(now().getTime() + windowHours * 3600000)],
        )
      ).rows;
      for (const row of rows) await enqueue(row);
      await pool.query(
        "INSERT INTO worker_heartbeat(role,seen_at) VALUES('delivery',clock_timestamp()) ON CONFLICT(role) DO UPDATE SET seen_at=excluded.seen_at",
      );
    } finally {
      scanning = false;
    }
  }
  await scan();
  const interval = setInterval(() => {
    void scan().catch(() => console.error("Delivery dispatch unavailable"));
  }, intervalMs);
  return {
    scan,
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      while (scanning) await new Promise((resolve) => setTimeout(resolve, 10));
      await boss.stop({ graceful: true });
      await pool.end();
    },
  };
}

import { beforeAll, afterAll, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/app.js";
import { migrate } from "../src/database.js";
import { dropFixtureDatabase } from "./database-cleanup.js";
import { startDeliveryWorker } from "../src/delivery-worker.js";
import type { PushRequest } from "../src/apns.js";
const root =
    process.env.DATABASE_URL ??
    "postgres://haiji:haiji@127.0.0.1:55432/haiji_test",
  name = "location_" + randomUUID().replaceAll("-", ""),
  url = new URL(root);
url.pathname = "/" + name;
const databaseUrl = url.toString(),
  maintenance = new pg.Pool({ connectionString: root }),
  db = new pg.Pool({ connectionString: databaseUrl }),
  admin = "location-admin".repeat(4),
  apns = { topic: "app.haiji.Haiji", environment: "development" as const };
let app: Awaited<ReturnType<typeof createApp>>,
  worker: Awaited<ReturnType<typeof startDeliveryWorker>>,
  token = "",
  deviceId = "",
  clock = new Date();
const sent: PushRequest[] = [];
async function call(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
  bearer = token,
  key = randomUUID(),
) {
  const r = await app.inject({
    url: path,
    method,
    headers: { authorization: "Bearer " + bearer, "idempotency-key": key },
    ...(body ? { payload: body } : {}),
  });
  return { status: r.statusCode, body: r.json() };
}
const place = () => ({
  id: randomUUID(),
  name: "公司 " + randomUUID().slice(0, 6),
  latitude: 37.3,
  longitude: -122.0,
  radius: 200,
});
let company: ReturnType<typeof place> & { revision: number };
async function draft(transition = "enter", extra = {}) {
  const input = {
    taskId: randomUUID(),
    commandId: randomUUID(),
    title: "location PRIVATE",
    background: "evidence",
    deadline: { kind: "date", date: "2030-10-20", timeZone: "UTC" },
    locationReminder: {
      placeId: company.id,
      placeRevision: company.revision,
      transition,
      timeZone: "UTC",
      quietHoursConfirmed: true,
    },
    ...extra,
  };
  const r = await call("/v1/tasks", "POST", input);
  expect(r.status).toBe(200);
  return r.body;
}
async function event(task: any, extra = {}, key = randomUUID()) {
  const p = task.locationReminder;
  return call(
    "/v1/location-events",
    "POST",
    {
      planId: p.id,
      reminderRevision: p.reminderRevision,
      transition: p.transition,
      observedAt: clock.toISOString(),
      ...extra,
    },
    token,
    key,
  );
}
async function receipt(task: any, status = "monitoring") {
  const p = task.locationReminder;
  return call("/v1/location-plans/receipts", "POST", {
    planId: p.id,
    reminderRevision: p.reminderRevision,
    status,
  });
}
async function action(task: any, operation: string, extra = {}) {
  return call(`/v1/tasks/${task.id}/commands`, "POST", {
    commandId: randomUUID(),
    clientMutationId: randomUUID(),
    expectedRevision: task.revision,
    operation,
    ...extra,
  });
}
async function accepted(id: string) {
  for (let n = 0; n < 100; n++) {
    await worker.scan();
    await db.query(
      "UPDATE pgboss.job SET start_after=clock_timestamp() WHERE name='remote-delivery'",
    );
    const t = (await call("/v1/tasks/" + id)).body;
    if (t.locationReminder?.remoteOccurrence?.status === "accepted") return t;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Remote push not accepted");
}
beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${name}`);
  await migrate(databaseUrl);
  app = await createApp({
    databaseUrl,
    adminSecret: admin,
    publicUrl: "https://haiji.example",
    environmentName: "location tests",
    pushMode: "self_signed",
    apns,
    modelDataDestination: "none",
    clock: () => clock,
  });
  const code = (await call("/v1/admin/pairings", "POST", {}, admin)).body.code;
  const credentials = (
    await call("/v1/pairings/claim", "POST", {
      code,
      deviceName: "region test",
    })
  ).body;
  token = credentials.accessToken;
  deviceId = credentials.deviceId;
  await call(`/v1/devices/${deviceId}/push`, "PUT", {
    ...apns,
    token: "ab".repeat(32),
    enabled: true,
    authorized: true,
  });
  company = (await call("/v1/places", "POST", place())).body;
  worker = await startDeliveryWorker({
    databaseUrl,
    apns,
    clock: () => clock,
    scanIntervalMs: 100,
    send: async (r) => {
      sent.push(r);
      return { status: "accepted" };
    },
  });
});
afterAll(async () => {
  await worker?.stop();
  await app?.close();
  await db.end();
  await dropFixtureDatabase(maintenance, name);
  await maintenance.end();
});
test("place ownership, bounds, unique name and retry identity are enforced", async () => {
  expect((await call("/v1/places", "GET", undefined, "invalid")).status).toBe(
    401,
  );
  for (const extra of [
    { latitude: 91 },
    { longitude: -181 },
    { radius: 99 },
    { radius: 1001 },
    { name: "   " },
    { ownerId: randomUUID() },
  ])
    expect(
      (await call("/v1/places", "POST", { ...place(), ...extra })).status,
    ).toBe(422);
  const p = place(),
    key = randomUUID();
  const saved = await call("/v1/places", "POST", p, token, key);
  expect(saved.status).toBe(200);
  expect((await call("/v1/places", "POST", p, token, key)).body).toEqual(
    saved.body,
  );
  expect(
    (await call("/v1/places", "POST", { ...p, name: "changed" }, token, key))
      .status,
  ).toBe(409);
  expect(
    (await call("/v1/places", "POST", { ...p, id: randomUUID() })).status,
  ).toBe(409);
  expect((await draft()).reminder).toBeNull();
});
test("only a current monitored region can trigger; retries and concurrent event keys send one generic remote push", async () => {
  const t = await draft();
  expect(t.locationReminder.remoteOccurrence).toBeUndefined();
  expect((await event(t)).status).toBe(409);
  expect((await receipt(t)).status).toBe(200);
  expect((await event(t, { latitude: 1 })).status).toBe(422);
  expect((await event(t, { transition: "exit" })).status).toBe(409);
  expect(
    (
      await event(t, {
        observedAt: new Date(clock.getTime() - 901000).toISOString(),
      })
    ).status,
  ).toBe(422);
  const key = randomUUID(),
    body = { observedAt: clock.toISOString() };
  const results = await Promise.all([
    event(t, body, key),
    event(t, body, key),
    event(t, body),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  const current = await accepted(t.id);
  expect(current.locationReminder.installationStatus).toBe("triggered");
  expect(current.locationReminder.triggeredAt).toBe(clock.toISOString());
  expect(current.reminder).toBeNull();
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0]?.payload)).not.toMatch(
    /PRIVATE|latitude|longitude|公司/,
  );
  const edit = await action(current, "edit", { title: "metadata only" });
  expect(edit.status).toBe(200);
  expect(edit.body.locationReminder.id).toBe(t.locationReminder.id);
  expect(edit.body.locationReminder.remoteOccurrence.status).toBe("accepted");
});
test("exit conditions, completion and stale notification authority do not resurrect plans", async () => {
  const t = await draft("exit");
  await receipt(t);
  expect((await event(t, { transition: "enter" })).status).toBe(409);
  const done = await action(t, "complete");
  expect(done.status).toBe(200);
  expect(done.body.locationReminder).toBeNull();
  expect((await event(t)).status).toBe(409);
  expect((await receipt(t)).status).toBe(409);
  const restored = await action(done.body, "restore");
  expect(restored.status).toBe(200);
  expect(restored.body.locationReminder.transition).toBe("exit");
  expect(restored.body.locationReminder.id).not.toBe(t.locationReminder.id);
  await action(restored.body, "cancel");
});
test("place modification lists affected tasks, rejects old events and receipts, and requires explicit new configuration", async () => {
  const t = await draft();
  await receipt(t);
  await event(t);
  const oldRemote = (await call("/v1/tasks/" + t.id)).body.locationReminder
    .remoteOccurrence;
  const impact = await call(`/v1/places/${company.id}/impact`);
  expect(impact.body.tasks.some((x: any) => x.id === t.id)).toBe(true);
  const key = randomUUID(),
    change = {
      expectedRevision: company.revision,
      expectedAffectedTaskIds: impact.body.tasks.map((x: any) => x.id),
      name: company.name,
      latitude: 37.4,
      longitude: -122.1,
      radius: 300,
    };
  const updated = await call(
    "/v1/places/" + company.id,
    "PUT",
    change,
    token,
    key,
  );
  expect(updated.status).toBe(200);
  expect(updated.body.affectedTaskIds).toContain(t.id);
  expect(updated.body.deviceCleanup).toBe("pending");
  expect(
    (await call("/v1/places/" + company.id, "PUT", change, token, key)).body,
  ).toEqual(updated.body);
  expect((await event(t)).status).toBe(409);
  expect((await receipt(t)).status).toBe(409);
  const current = (await call("/v1/tasks/" + t.id)).body;
  expect(current.revision).toBe(2);
  expect(current.locationReminder.installationStatus).toBe(
    "needs_configuration",
  );
  expect(current.status).toBe("active");
  const oldAction = await action(current, "complete", {
    occurrence: {
      id: oldRemote.id,
      reminderRevision: oldRemote.reminderRevision,
      routingVersion: 1,
      requestId: "haiji.remote." + oldRemote.id + ".1",
    },
  });
  expect(oldAction.status).toBe(409);
  expect(oldAction.body.code).toBe("STALE_PLAN");
  company = { ...company, ...change, revision: company.revision + 1 };
  const reconfigured = await action(current, "edit", {
    locationReminder: {
      placeId: company.id,
      placeRevision: company.revision,
      transition: "exit",
      timeZone: "UTC",
    },
  });
  expect(reconfigured.status).toBe(200);
  expect(reconfigured.body.locationReminder.place.radius).toBe(300);
  expect((await event(t)).status).toBe(409);
  const time = new Date(clock.getTime() + 3600000).toISOString();
  const fallback = await action(reconfigured.body, "snooze", {
    reminder: { instant: time, timeZone: "UTC" },
    quietHoursConfirmed: true,
  });
  expect(fallback.status).toBe(200);
  expect(fallback.body.locationReminder).toBeNull();
  expect(fallback.body.reminder.instant).toBe(time);
  expect(fallback.body.reminder.remoteOccurrence.status).toBe("planned");
  expect(fallback.body.deadline).toEqual(t.deadline);
  expect(fallback.body.sources).toEqual(t.sources);
  expect((await event(reconfigured.body)).status).toBe(409);
  await action(fallback.body, "cancel");
});
test("deletion preserves tasks; stale place revisions and ambiguous mixed conditions are rejected", async () => {
  const p = (await call("/v1/places", "POST", place())).body;
  const t = await draft("enter", {
    locationReminder: {
      placeId: p.id,
      placeRevision: p.revision,
      transition: "enter",
      timeZone: "UTC",
    },
  });
  expect(
    (
      await call("/v1/places/" + p.id, "DELETE", {
        expectedRevision: 2,
        expectedAffectedTaskIds: [t.id],
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("/v1/places/" + p.id, "DELETE", {
        expectedRevision: 1,
        expectedAffectedTaskIds: [t.id],
      })
    ).status,
  ).toBe(200);
  const current = (await call("/v1/tasks/" + t.id)).body;
  expect(current.status).toBe("active");
  expect(current.locationReminder.installationStatus).toBe(
    "needs_configuration",
  );
  expect((await event(t)).status).toBe(409);
  const input = {
    taskId: randomUUID(),
    commandId: randomUUID(),
    title: "bad",
    locationReminder: {
      placeId: company.id,
      placeRevision: 1,
      transition: "enter",
      timeZone: "UTC",
    },
  };
  expect((await call("/v1/tasks", "POST", input)).status).toBe(409);
  expect(
    (
      await call("/v1/tasks", "POST", {
        ...input,
        locationReminder: {
          ...input.locationReminder,
          placeRevision: company.revision,
        },
        reminder: {
          instant: new Date(clock.getTime() + 3600000).toISOString(),
          timeZone: "UTC",
        },
      })
    ).status,
  ).toBe(422);
});
test("quiet-hour events require confirmation and notification actions verify the current geographic authority", async () => {
  let delta = (23 - clock.getUTCHours() + 24) % 24;
  if (delta > 12) delta -= 24;
  const zone =
    delta === 0 ? "UTC" : "Etc/GMT" + (delta > 0 ? "-" : "+") + Math.abs(delta);
  const t = await draft("enter", {
    locationReminder: {
      placeId: company.id,
      placeRevision: company.revision,
      transition: "enter",
      timeZone: zone,
      quietHoursConfirmed: false,
    },
  });
  await receipt(t);
  const eventResult = await event(t);
  expect(eventResult.body.status).toBe("needs_confirmation");
  const p = t.locationReminder;
  const confirmed = await call(
    `/v1/tasks/${t.id}/remote-confirmation`,
    "POST",
    {
      occurrenceId: (await call("/v1/tasks/" + t.id)).body.locationReminder
        .remoteOccurrence.id,
      reminderRevision: p.reminderRevision,
    },
  );
  expect(confirmed.status).toBe(200);
  const current = await accepted(t.id),
    remote = current.locationReminder.remoteOccurrence;
  const occurrence = {
    id: remote.id,
    reminderRevision: remote.reminderRevision,
    routingVersion: 2,
    requestId: "haiji.remote." + remote.id + ".1",
  };
  expect((await action(current, "complete", { occurrence })).status).toBe(409);
  expect(
    (
      await action(current, "complete", {
        occurrence: { ...occurrence, routingVersion: 1 },
      })
    ).status,
  ).toBe(200);
});

test("permission denial prevents observed sends and repeat migration never manufactures a trigger", async () => {
  const t = await draft();
  expect((await receipt(t, "permission_denied")).status).toBe(200);
  expect((await event(t)).status).toBe(409);
  await migrate(databaseUrl);
  await migrate(databaseUrl);
  const current = (await call("/v1/tasks/" + t.id)).body;
  expect(current.locationReminder.remoteOccurrence).toBeUndefined();
  expect(current.locationReminder.id).toBe(t.locationReminder.id);
  expect(
    (await call("/v1/location-plans")).body.plans.some(
      (p: any) => p.id === t.locationReminder.id,
    ),
  ).toBe(true);
  const before = sent.length;
  await call("/v1/admin/devices/" + deviceId, "DELETE", undefined, admin);
  expect((await event(t)).status).toBe(401);
  await worker.scan();
  expect(sent.length).toBe(before);
});

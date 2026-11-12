import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { Types, type Connection } from "mongoose";
import pino from "pino";
import supertest from "supertest";
import { expect, test as baseTest, vi } from "vitest";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";
import { requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { test } from "../helpers/api-fixture.js";
import { createRestartableMongo } from "../helpers/restartable-mongo.js";
import { hostileHtml, nestedCapture, nestedExpected } from "../fixtures/capture-security.js";
import { MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import { createApiServer } from "../../apps/api/src/server.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { createInboxService } from "../../apps/api/src/services/inboxes.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";
import { createLocalCaptureRouter } from "../../apps/api/src/routes/local-capture.js";

async function createHarness(connection: Connection, captureBody = true) {
  const owner = { actorId: new Types.ObjectId(), workspaceId: new Types.ObjectId() };
  await bootstrapLocalWorkspace(connection, { ownerId: owner.actorId, workspaceId: owner.workspaceId, name: "Synthetic workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const inboxes = await createInboxService(connection, crypto);
  const inbox = await inboxes.createForOwner(owner, { name: "Synthetic inbox" });
  const tokens = createCaptureTokenService(connection, crypto);
  const token = await tokens.retrieveForOwner({ ...owner, inboxId: new Types.ObjectId(inbox.id) });
  const logs: string[] = [];
  const logger = pino({}, new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } }));
  const router = createLocalCaptureRouter(connection, crypto, owner.workspaceId,
    { captureBody, sensitiveJsonKeys: ["custom_credential", "x-secret"] });
  const server = createApiServer(() => Promise.resolve(true), logger, undefined, router);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { owner, inboxId: new Types.ObjectId(inbox.id), token, request: supertest(server), logs: () => logs.join(""),
    async close() {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
const securityTest = test.extend("capture", async ({ mongo }, { onCleanup }) => {
  const capture = await createHarness(mongo.connection); onCleanup(capture.close); return capture;
});
// eslint-disable-next-line no-empty-pattern -- Vitest requires a destructured fixture context.
const outageTest = baseTest.extend("mongo", async ({}, { onCleanup }) => {
  const mongo = await createRestartableMongo(); onCleanup(mongo.close); return mongo;
}).extend("capture", async ({ mongo }, { onCleanup }) => {
  const capture = await createHarness(mongo.connection); onCleanup(capture.close); return capture;
});

securityTest("stored nested fixture removes default and configured secrets through arrays and reserved keys", async ({ capture, mongo }) => {
  const response = await capture.request.post(`/capture/${capture.token}?secret=synthetic-private-query`)
    .set("Content-Type", "application/json").set("Authorization", "synthetic-private-header")
    .set("Cookie", "synthetic-private-cookie").set("X-Api-Key", "synthetic-private-key").send(nestedCapture);
  expect(response.status).toBe(201); expect(response.body.data.captured).toBe(true);
  const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
  expect(event).not.toBeNull(); expect(event!.workspaceId.equals(capture.owner.workspaceId)).toBe(true);
  expect(event!.inboxId.equals(capture.inboxId)).toBe(true); expect(event!.format).toBe("json");
  expect(event!.parseFailed).toBe(false); expect(event!.redaction.jsonKeysRemoved).toBe(8);
  expect(["synthetic-secret-", "synthetic-private-", capture.token].some(value =>
    JSON.stringify(event).includes(value) || JSON.stringify(response.body).includes(value) || capture.logs().includes(value))).toBe(false);
  const body = JSON.parse(event!.safeBody) as Record<string, unknown>;
  expect(body).toEqual(nestedExpected); expect(Object.hasOwn(body, "__proto__")).toBe(true);
  expect(Object.hasOwn(Object.prototype, "safe")).toBe(false);
  expect(Object.hasOwn(Object.prototype, "syntheticCaptureExecuted")).toBe(false);
  expect(event!.safeHeaders).toEqual({ "content-type": "application/json" });
});

securityTest("hostile HTML is stored as inert text and never reflected in the capture response or logs", async ({ capture, mongo }) => {
  const response = await capture.request.post(`/capture/${capture.token}?secret=synthetic-private-query`)
    .set("Content-Type", "text/html").set("Accept", "text/html").send(hostileHtml);
  expect(response.status).toBe(201); expect(response.headers["content-type"]).toMatch(/^application\/json/);
  expect(Object.keys(response.body)).toEqual(["data"]);
  expect(Object.keys(response.body.data).sort()).toEqual(["captured", "eventId"]);
  expect(response.body.data.captured).toBe(true); expect(response.body.data.eventId).toMatch(/^[a-f0-9]{24}$/);
  expect(response.text.includes("syntheticCaptureExecuted") || capture.logs().includes("syntheticCaptureExecuted")).toBe(false);
  const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
  expect(event!.format).toBe("text"); expect(event!.contentType).toBe("text/html"); expect(event!.safeBody).toBe(hostileHtml);
  expect(Object.hasOwn(globalThis, "syntheticCaptureExecuted")).toBe(false);
  // This is storage/response behavior; no event-inspection page exists yet.
});

securityTest("body-disabled policy omits hostile HTML entirely and a later normal capture succeeds", async ({ mongo }) => {
  const capture = await createHarness(mongo.connection, false);
  try {
    const response = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/html").send(hostileHtml);
    expect(response.status).toBe(201);
    const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
    expect(event!.format).toBe("omitted"); expect(event!.safeBody).toBeNull(); expect(event!.redaction.bodyOmitted).toBe(true);
    expect(JSON.stringify(event).includes(hostileHtml) || capture.logs().includes(hostileHtml)).toBe(false);
    expect((await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}')).status).toBe(201);
    expect(await mongo.connection.collection("events").countDocuments()).toBe(2);
  } finally { await capture.close(); }
});

securityTest("oversized and unsupported captures never persist partial events; a valid request recovers", async ({ capture, mongo }) => {
  const oversized = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("a".repeat(MAX_CAPTURE_BYTES + 1));
  expect(oversized.status).toBe(413); expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  const unsupported = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/octet-stream").send(Buffer.from([0, 255]));
  expect(unsupported.status).toBe(415); expect(unsupported.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
  const success = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("synthetic recovery");
  expect(success.status).toBe(201); expect(await mongo.connection.collection("events").countDocuments()).toBe(1);
});

outageTest("real Mongo shutdown at insert returns safe 503; after restart the same listener recovers", async ({ capture, mongo }) => {
  const before = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{"ok":"before"}');
  expect(before.status).toBe(201);
  const events = mongo.connection.collection("events"), insert = events.insertOne.bind(events);
  const spy = vi.spyOn(events, "insertOne").mockImplementationOnce(async (...args) => {
    // The real process exits after token lookup and before the actual driver insert.
    await mongo.stop(); return insert(...args);
  });
  const fail = await capture.request.post(`/capture/${capture.token}?secret=synthetic-private-query`)
    .set("Content-Type", "application/json").set("Authorization", "synthetic-private-header").send('{"secret":"synthetic-secret-outage"}');
  expect(spy).toHaveBeenCalledTimes(1); expect(fail.status).toBe(503);
  const parsed = apiErrorResponseSchema.parse(fail.body);
  expect(parsed.error.code).toBe("STORAGE_UNAVAILABLE"); expect(requestIdSchema.safeParse(parsed.error.requestId).success).toBe(true);
  expect(fail.headers["x-request-id"]).toBe(parsed.error.requestId); expect(fail.headers["cache-control"]).toBe("no-store");
  expect(Object.hasOwn(fail.body, "data")).toBe(false);
  const lookup = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("synthetic-private-lookup");
  expect(lookup.status).toBe(503); expect(lookup.body.error.code).toBe("STORAGE_UNAVAILABLE");
  expect([capture.token, mongo.uri, "synthetic-private", "synthetic-secret"].some(value =>
    JSON.stringify([fail.body, lookup.body]).includes(value) || capture.logs().includes(value))).toBe(false);
  await mongo.restart();
  // Here Mongo stopped before insert began, so these specific requests made no write.
  // This does not rule out ambiguous outcomes after a dispatched write.
  expect(await events.countDocuments()).toBe(1);
  const recovered = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{"ok":"after"}');
  expect(recovered.status).toBe(201); expect(recovered.body.data.captured).toBe(true);
  expect(await events.countDocuments()).toBe(2);
  expect(await events.findOne({ _id: new Types.ObjectId(before.body.data.eventId) })).not.toBeNull();
  expect(await events.findOne({ _id: new Types.ObjectId(recovered.body.data.eventId) })).not.toBeNull();
}, 40_000);

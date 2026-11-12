import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Writable } from "node:stream";
import { Types } from "mongoose";
import pino from "pino";
import supertest from "supertest";
import { expect, vi } from "vitest";
import { test } from "../helpers/api-fixture.js";
import { availablePort, stopProcess } from "../helpers/api-process.js";
import { createApiServer } from "../../apps/api/src/server.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { createInboxService } from "../../apps/api/src/services/inboxes.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";
import { createLocalCaptureRouter } from "../../apps/api/src/routes/local-capture.js";

const captureTest = test.extend("capture", async ({ mongo }, { onCleanup }) => {
  const owner = { actorId: new Types.ObjectId(), workspaceId: new Types.ObjectId() };
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: owner.actorId, workspaceId: owner.workspaceId, name: "Synthetic capture" });
  const key = randomBytes(32);
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", key]]) });
  const inboxes = await createInboxService(mongo.connection, crypto);
  const inbox = await inboxes.createForOwner(owner, { name: "Synthetic inbox" });
  const context = { ...owner, inboxId: new Types.ObjectId(inbox.id) };
  const tokens = createCaptureTokenService(mongo.connection, crypto);
  const token = await tokens.retrieveForOwner(context);
  const logs: string[] = [];
  const logger = pino({}, new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } }));
  const router = createLocalCaptureRouter(mongo.connection, crypto, owner.workspaceId, { sensitiveJsonKeys: ["private_value"] });
  const server = createApiServer(() => Promise.resolve(true), logger, undefined, router);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  onCleanup(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return { owner, key, crypto, inbox, context, tokens, inboxes, token, server, request: supertest(server), logs: () => logs.join("") };
});
const idPattern = /^[a-f0-9]{24}$/;

captureTest("writes only sanitized JSON metadata and expiry before returning its event ID", async ({ capture, mongo }) => {
  const input = '{"password":"synthetic-private-body","nested":[{"PRIVATE_VALUE":"synthetic-private-value","ok":1}],"a.b":{"$literal":"safe"},"nul\\u0000key":"value"}';
  const response = await capture.request.post(`/capture/${capture.token}?secret=synthetic-private-query`).set("Content-Type", "application/json; charset=utf-8")
    .set("Authorization", "synthetic-private-header").set("Cookie", "synthetic-private-cookie").send(input);
  expect(response.status).toBe(201); expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual({ data: { eventId: expect.stringMatching(idPattern), captured: true } });
  const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
  expect(event).not.toBeNull();
  expect(event!.workspaceId.equals(capture.owner.workspaceId)).toBe(true); expect(event!.inboxId.equals(capture.context.inboxId)).toBe(true);
  expect(event!.method).toBe("POST"); expect(event!.receivedBytes).toBe(Buffer.byteLength(input));
  expect(event!.expiresAt.getTime() - event!.receivedAt.getTime()).toBe(7 * 86_400_000);
  expect(event!.format).toBe("json"); expect(event!.parseFailed).toBe(false); expect(event!.parseFailureReason).toBeNull();
  expect(JSON.parse(event!.safeBody)).toEqual({ nested: [{ ok: 1 }], "a.b": { "$literal": "safe" }, "nul\u0000key": "value" });
  expect(event!.safeHeaders).toEqual({ "content-type": "application/json" }); expect(event!.contentType).toBe("application/json");
  expect(event!.redaction).toEqual({ headerPolicy: "content-type-only", jsonKeysRemoved: 2, bodyOmitted: false });
  expect(event!.signatureState).toBe("unverified");
  expect(["synthetic-private", capture.token].some(value => JSON.stringify(event).includes(value) || capture.logs().includes(value))).toBe(false);
  expect(Object.keys(event!).sort()).toEqual(["_id", "workspaceId", "inboxId", "receivedAt", "expiresAt", "method", "receivedBytes", "contentType", "safeHeaders", "format", "safeBody", "parseFailed", "parseFailureReason", "redaction", "signatureState"].sort());
});

captureTest("preserves parse flags, formats, metadata-only methods, bodyless HEAD and event-free OPTIONS", async ({ capture, mongo }) => {
  const malformed = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{"synthetic-private":');
  expect(malformed.status).toBe(201);
  const invalid = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(malformed.body.data.eventId) });
  expect(invalid!.format).toBe("unparsed"); expect(invalid!.parseFailed).toBe(true);
  expect(invalid!.parseFailureReason).toBe("invalid_json"); expect(invalid!.safeBody).toBeNull();
  expect(JSON.stringify(invalid).includes("synthetic-private")).toBe(false);
  const form = await capture.request.put(`/capture/${capture.token}`).set("Content-Type", "application/x-www-form-urlencoded").send("a=1&a=2");
  expect(form.status).toBe(201);
  const formEvent = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(form.body.data.eventId) });
  expect(formEvent!.format).toBe("form"); expect(JSON.parse(formEvent!.safeBody)).toEqual([["a", "1"], ["a", "2"]]);
  const text = await capture.request.patch(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("synthetic text");
  expect(text.status).toBe(201);
  const textEvent = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(text.body.data.eventId) });
  expect(textEvent!.format).toBe("text"); expect(textEvent!.safeBody).toBe("synthetic text");
  const get = await capture.request.get(`/capture/${capture.token}`); expect(get.status).toBe(201);
  const getEvent = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(get.body.data.eventId) });
  expect(getEvent!.format).toBe("metadata"); expect(getEvent!.safeBody).toBeNull();
  const head = await capture.request.head(`/capture/${capture.token}`); expect(head.status).toBe(201); expect(head.text).toBeUndefined();
  expect(await mongo.connection.collection("events").countDocuments({ method: "HEAD", format: "metadata", safeBody: null })).toBe(1);
  expect((await capture.request.options(`/capture/${capture.token}`)).status).toBe(204);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(5);
});

captureTest("repeated deliveries get distinct IDs and expiry uses the resolved inbox retention snapshot", async ({ capture, mongo }) => {
  await mongo.connection.collection("inboxes").updateOne({ _id: capture.context.inboxId }, { $set: { retentionDays: 1 } });
  const first = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}');
  const second = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}');
  expect(first.status).toBe(201); expect(second.status).toBe(201); expect(first.body.data.eventId).not.toBe(second.body.data.eventId);
  for (const id of [first.body.data.eventId, second.body.data.eventId]) {
    const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(id) });
    expect(event!.expiresAt.getTime() - event!.receivedAt.getTime()).toBe(86_400_000);
  }
  expect(await mongo.connection.collection("events").countDocuments()).toBe(2);
});

captureTest("foreign, disabled, rotated and invalid tokens cannot store events or reveal foreign disabled state", async ({ capture, mongo }) => {
  const foreign = { actorId: new Types.ObjectId(), workspaceId: new Types.ObjectId() };
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: foreign.actorId, workspaceId: foreign.workspaceId, name: "Other workspace" });
  const other = await capture.inboxes.createForOwner(foreign, { name: "Other inbox" });
  const otherContext = { ...foreign, inboxId: new Types.ObjectId(other.id) };
  const foreignToken = await capture.tokens.retrieveForOwner(otherContext);
  expect((await capture.request.post(`/capture/${foreignToken}`).set("Content-Type", "text/plain").send("synthetic")).status).toBe(404);
  await capture.inboxes.disableForOwner(foreign, otherContext.inboxId);
  expect((await capture.request.post(`/capture/${foreignToken}`).set("Content-Type", "text/plain").send("synthetic")).status).toBe(404);
  expect((await capture.request.post('/capture/invalid').set("Content-Type", "text/plain").send("synthetic")).status).toBe(404);
  await capture.inboxes.disableForOwner(capture.owner, capture.context.inboxId);
  expect((await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("synthetic")).status).toBe(410);
  await capture.tokens.rotateForOwner(capture.context);
  expect((await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "text/plain").send("synthetic")).status).toBe(404);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
  expect([capture.token, foreignToken].some(value => capture.logs().includes(value))).toBe(false);
});

captureTest("response waits for the actual journaled insert acknowledgement", async ({ capture, mongo }) => {
  const events = mongo.connection.collection("events"), insert = events.insertOne.bind(events);
  let resume!: () => void, signal!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const written = new Promise<void>(resolve => { signal = resolve; });
  const spy = vi.spyOn(events, "insertOne").mockImplementationOnce(async (...args) => {
    const result = await insert(...args); signal(); await gate; return result;
  });
  const pending = capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}').then(result => result);
  try {
    await written;
    expect(await mongo.connection.collection("events").countDocuments()).toBe(1);
    expect(await Promise.race([pending.then(() => "responded"), delay(100).then(() => "pending")])).toBe("pending");
  } finally { resume(); }
  const response = await pending;
  expect(response.status).toBe(201); expect(response.body.data.captured).toBe(true);
  expect(spy.mock.calls[0]![1]).toMatchObject({ writeConcern: { w: "majority", journal: true }, timeoutMS: 10_000 });
});

captureTest("storage errors return safe 503 and recover; an error after insertion has an uncertain outcome", async ({ capture, mongo }) => {
  const events = mongo.connection.collection("events"), insert = events.insertOne.bind(events);
  const spy = vi.spyOn(events, "insertOne");
  spy.mockRejectedValueOnce(new Error("synthetic-private-driver"));
  const fail = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}');
  expect(fail.status).toBe(503); expect(fail.body.error.code).toBe("STORAGE_UNAVAILABLE");
  expect(await events.countDocuments()).toBe(0);
  spy.mockImplementationOnce(async (...args) => { await insert(...args); throw new Error("synthetic-private-driver"); });
  const uncertain = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}');
  expect(uncertain.status).toBe(503); expect(await events.countDocuments()).toBe(1);
  const recovered = await capture.request.post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{}');
  expect(recovered.status).toBe(201); expect(await events.countDocuments()).toBe(2);
  expect(JSON.stringify([fail.body, uncertain.body]).includes("synthetic-private-driver") || capture.logs().includes("synthetic-private-driver")).toBe(false);
});

captureTest("trusted disabled-body policy persists no body and cannot be overridden by inbound headers", async ({ capture, mongo }) => {
  const router = createLocalCaptureRouter(mongo.connection, capture.crypto, capture.owner.workspaceId, { captureBody: false });
  const server = createApiServer(() => Promise.resolve(true), undefined, undefined, router);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await supertest(server).post(`/capture/${capture.token}`).set("Content-Type", "text/plain").set("X-Capture-Body", "true").send("synthetic-private-body");
    expect(response.status).toBe(201);
    const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
    expect(event!.format).toBe("omitted"); expect(event!.safeBody).toBeNull(); expect(event!.redaction.bodyOmitted).toBe(true);
    expect(JSON.stringify(event).includes("synthetic-private-body")).toBe(false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

captureTest("the actual local dashboard process mounts durable capture using only its configured workspace", async ({ capture, mongo }) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/local-dashboard.ts"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", MONGODB_URI: mongo.uri, API_PORT: String(port),
      LOCAL_OWNER_ID: capture.owner.actorId.toHexString(), LOCAL_WORKSPACE_ID: capture.owner.workspaceId.toHexString(),
      LOCAL_WORKSPACE_NAME: "Synthetic workspace", LOCAL_SENSITIVE_JSON_KEYS: '["customField"]', CAPTURE_TOKEN_KEY_VERSION: "test-v1", CAPTURE_TOKEN_KEY_HEX: capture.key.toString("hex") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
  let output = ""; child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
  const deadline = Date.now() + 15_000;
  while (!output.includes("Local dashboard API listening")) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error("Disposable local dashboard failed to start");
    await delay(25);
  }
  const response = await supertest(`http://127.0.0.1:${port}`).post(`/capture/${capture.token}`).set("Content-Type", "application/json").send('{"password":"synthetic-private","customField":"synthetic-private","ok":true}');
  expect(response.status).toBe(201);
  const event = await mongo.connection.collection("events").findOne({ _id: new Types.ObjectId(response.body.data.eventId) });
  expect(JSON.parse(event!.safeBody)).toEqual({ ok: true });
  expect(output.includes(capture.token) || output.includes("synthetic-private") || output.includes(capture.key.toString("hex"))).toBe(false);
  const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
  } finally { await stopProcess(child); }
});

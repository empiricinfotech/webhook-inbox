import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Types } from "mongoose";
import supertest from "supertest";
import { expect } from "vitest";
import { test } from "../helpers/api-fixture.js";
import type { MongoFixture } from "../helpers/mongo-fixture.js";
import { createApp } from "../../apps/api/src/app.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { createLocalInboxRouter } from "../../apps/api/src/routes/local-inboxes.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { pageResponseSchema } from "@empiric-webhook-inbox/contracts/pagination";
import { inboxSummarySchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";

async function setup(mongo: MongoFixture) {
  const actorId = new Types.ObjectId(), workspaceId = new Types.ObjectId();
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: actorId, workspaceId, name: "Synthetic UI workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const access = { actorId, workspaceId, webOrigin: "http://127.0.0.1:3000", apiHost: "127.0.0.1:4000" };
  const router = await createLocalInboxRouter(mongo.connection, crypto, access);
  const client = supertest(createApp(() => Promise.resolve(true), undefined, router));
  const base = `/api/v1/workspaces/${workspaceId.toHexString()}/inboxes`;
  const get = (path: string) => client.get(path).set("Host", access.apiHost);
  const post = (path: string) => client.post(path).set("Host", access.apiHost).set("Origin", access.webOrigin);
  return { access, client, base, get, post, crypto };
}

test("local context, empty page, persisted create/detail/reload and list expose safe metadata only", async ({ mongo }) => {
  const { access, base, get, post, crypto } = await setup(mongo);
  const context = await get("/api/v1/local-workspace").expect(200).expect("Cache-Control", "no-store");
  expect(context.body).toEqual({ data: { id: access.workspaceId.toHexString(), name: "Synthetic UI workspace" } });
  expect((await get(base).expect(200)).body).toEqual({ data: [], nextCursor: null });
  const created = await post(base).send({ name: " Synthetic UI inbox ", description: "synthetic" }).expect(201);
  expect(created.headers.location).toBe(`/api/v1/inboxes/${created.body.data.id}`);
  const detail = await get(`/api/v1/inboxes/${created.body.data.id}`).expect(200);
  expect(detail.body).toEqual(created.body);
  inboxSummarySchema.parse(detail.body.data);
  const list = await get(base).expect(200).expect("Cache-Control", "no-store");
  expect(pageResponseSchema(inboxSummarySchema).parse(list.body).data).toEqual([detail.body.data]);
  const tokens = createCaptureTokenService(mongo.connection, crypto);
  const token = await tokens.retrieveForOwner({ actorId: access.actorId, workspaceId: access.workspaceId, inboxId: new Types.ObjectId(created.body.data.id) });
  const raw = await mongo.connection.collection("inboxes").findOne({ _id: new Types.ObjectId(created.body.data.id) });
  for (const response of [created, detail, list]) {
    expect(response.text.includes(token)).toBe(false);
    expect(response.text.includes(raw!.tokenHash)).toBe(false);
    expect(response.text.includes(raw!.encryptedToken.ciphertext)).toBe(false);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
  }
});

test("bounded cursor pages use timestamp/id ordering without gaps, repeats or foreign scope", async ({ mongo }) => {
  const { access, base, get } = await setup(mongo);
  const Inbox = getInboxModel(mongo.connection);
  const createdAt = new Date("2026-10-30T00:00:00.000Z");
  // Private fixture seeds metadata to exercise pagination without crypto-heavy repeated setup.
  await Inbox.insertMany(Array.from({ length: 27 }, (_, i) => ({ workspaceId: access.workspaceId, name: `Synthetic ${i}`, createdAt, updatedAt: createdAt })));
  const one = (await get(base).expect(200)).body;
  expect(one.data).toHaveLength(25);
  expect(typeof one.nextCursor).toBe("string");
  const two = (await get(`${base}?cursor=${one.nextCursor}`).expect(200)).body;
  expect(two.data).toHaveLength(2);
  expect(two.nextCursor).toBeNull();
  expect(new Set([...one.data, ...two.data].map((x: { id: string }) => x.id)).size).toBe(27);
  const expected = await Inbox.find({ workspaceId: access.workspaceId }).sort({ createdAt: -1, _id: -1 }).lean();
  expect([...one.data, ...two.data].map((x: { id: string }) => x.id)).toEqual(expected.map((x) => x._id.toHexString()));
  for (const query of ["limit=0", "limit=101", "limit[]=25", "cursor=bad", "sort=private",
    `cursor=${Buffer.from(JSON.stringify([new Types.ObjectId().toHexString(), createdAt.toISOString(), new Types.ObjectId().toHexString()])).toString("base64url")}`]) {
    await get(`${base}?${query}`).expect(400);
  }
});

test("fixed trusted local actor and workspace deny guessed IDs, supplied identity and changed ownership", async ({ mongo }) => {
  const { access, base, get, post } = await setup(mongo);
  const otherId = new Types.ObjectId();
  await get(`/api/v1/workspaces/${otherId.toHexString()}/inboxes`).expect(404);
  await post(`/api/v1/workspaces/${otherId.toHexString()}/inboxes`).send({ name: "Denied" }).expect(404);
  const Workspace = getWorkspaceModel(mongo.connection);
  const other = await Workspace.create({ ownerId: access.actorId, name: "Other synthetic" });
  const hidden = await getInboxModel(mongo.connection).create({ workspaceId: other._id, name: "Hidden" });
  await get(`/api/v1/inboxes/${hidden._id.toHexString()}`).expect(404);
  await get("/api/v1/inboxes/invalid").expect(400);
  await post(base).send({ name: "Denied", actorId: access.actorId.toHexString() }).expect(400);
  await Workspace.updateOne({ _id: access.workspaceId }, { $set: { ownerId: otherId } });
  await get(base).set("X-Actor-Id", otherId.toHexString()).expect(404);
  await get("/api/v1/local-workspace").expect(404);
  await post(base).send({ name: "Denied" }).expect(404);
});

test("Host/Origin/fetch-site guards reject cross-site reads/writes before parsing; normal API stays opt-in", async ({ mongo }) => {
  const { access, client, base, get, post } = await setup(mongo);
  await client.get(base).set("Host", "evil.example:4000").expect(403);
  await get(base).set("Origin", "https://evil.example").expect(403);
  await get(base).set("Sec-Fetch-Site", "cross-site").expect(403);
  await client.post(base).set("Host", access.apiHost).send({ name: "Denied" }).expect(403);
  await client.post(base).set("Host", access.apiHost).set("Origin", "null").send({ name: "Denied" }).expect(403);
  await client.options(base).set("Host", access.apiHost).set("Origin", "https://evil.example").expect(403);
  await supertest(createApp(() => Promise.resolve(true))).get(base).expect(404);
  await post("/api/v1/auth/register").send({}).expect(404);
  expect(await getInboxModel(mongo.connection).countDocuments()).toBe(0);
});

test("validation, malformed/oversized/compressed/unsupported bodies have safe errors; capture has no global parser", async ({ mongo }) => {
  const { base, post, get } = await setup(mongo);
  for (const input of [{ name: " " }, { name: "x", tokenHash: "synthetic-private-value" }, { name: "x", enabled: false }]) {
    await post(base).send(input).expect(400);
  }
  const malformed = await post(base).set("Content-Type", "application/json").send('{"synthetic-private-value":').expect(400);
  expect(malformed.text.includes("synthetic-private-value")).toBe(false);
  apiErrorResponseSchema.parse(malformed.body);
  await post(base).send({ name: "x", description: "s".repeat(5000) }).expect(413);
  await post(base).set("Content-Type", "text/plain").send("synthetic").expect(415);
  await post(base).set("Content-Type", "application/json").set("Content-Encoding", "gzip")
    .send(Buffer.concat([gzipSync('{"name":"synthetic"}'), Buffer.from("synthetic trailing bytes")])).expect(415);
  await get("/api/v1/local-workspace").expect(200);
  await post("/capture/synthetic").set("Content-Type", "application/json").send("invalid json").expect(404);
  expect(await getInboxModel(mongo.connection).countDocuments()).toBe(0);
});

test("database outage returns safe 503s with request correlation and no driver data", async ({ mongo }) => {
  const { base, get, post } = await setup(mongo);
  await mongo.connection.close();
  for (const make of [() => get(base), () => post(base).send({ name: "Synthetic" }), () => get(`/api/v1/inboxes/${new Types.ObjectId().toHexString()}`)]) {
    const response = await make().expect(503);
    const error = apiErrorResponseSchema.parse(response.body);
    expect(error.error.code).toBe("STORAGE_UNAVAILABLE");
    expect(error.error.requestId).toBe(response.headers["x-request-id"]);
    expect(response.text.includes("Mongo")).toBe(false);
  }
});

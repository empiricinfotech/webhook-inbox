import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import supertest from "supertest";
import { expect } from "vitest";
import { test } from "../helpers/api-fixture.js";
import type { MongoFixture } from "../helpers/mongo-fixture.js";
import { createApp } from "../../apps/api/src/app.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createLocalInboxRouter } from "../../apps/api/src/routes/local-inboxes.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { inboxEventListResponseSchema } from "@empiric-webhook-inbox/contracts/events";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";

async function setup(mongo: MongoFixture) {
  const actorId = new Types.ObjectId(), workspaceId = new Types.ObjectId();
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: actorId, workspaceId, name: "Synthetic event workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const access = { actorId, workspaceId, webOrigin: "http://127.0.0.1:3000", apiHost: "127.0.0.1:4000" };
  const router = await createLocalInboxRouter(mongo.connection, crypto, access);
  const client = supertest(createApp(() => Promise.resolve(true), undefined, router));
  const get = (path: string) => client.get(path).set("Host", access.apiHost);
  const inbox = await get(`/api/v1/workspaces/${workspaceId.toHexString()}/inboxes`).expect(200);
  const created = await client.post(`/api/v1/workspaces/${workspaceId.toHexString()}/inboxes`)
    .set("Host", access.apiHost).set("Origin", access.webOrigin).send({ name: "Synthetic event inbox" }).expect(201);
  expect(inbox.body.data).toHaveLength(0);
  return { access, get, inboxId: new Types.ObjectId(created.body.data.id) };
}

function storedEvent(workspaceId: Types.ObjectId, inboxId: Types.ObjectId, receivedAt: Date) {
  return { _id: new Types.ObjectId(), workspaceId, inboxId, receivedAt,
    expiresAt: new Date(receivedAt.getTime() + 7 * 24 * 60 * 60 * 1000), method: "POST",
    receivedBytes: 42, contentType: "application/json", safeHeaders: { "content-type": "application/json" },
    format: "json", safeBody: '{"synthetic_private_body":"must not be returned"}', parseFailed: false,
    parseFailureReason: null, redaction: { headerPolicy: "content-type-only", jsonKeysRemoved: 1, bodyOmitted: false },
    signatureState: "unverified" };
}

test("event list is bounded, newest first, inbox scoped, correlated and metadata only", async ({ mongo }) => {
  const { access, get, inboxId } = await setup(mongo);
  const base = new Date("2026-11-18T00:00:00.000Z");
  const records = Array.from({ length: 30 }, (_, index) =>
    storedEvent(access.workspaceId, inboxId, new Date(base.getTime() + index * 1000)));
  const otherInbox = new Types.ObjectId();
  records.push(storedEvent(access.workspaceId, otherInbox, new Date(base.getTime() + 60_000)));
  await mongo.connection.collection("events").insertMany(records);

  const response = await get(`/api/v1/inboxes/${inboxId.toHexString()}/events`).expect(200)
    .expect("Cache-Control", "no-store");
  const parsed = inboxEventListResponseSchema.parse(response.body);
  expect(parsed.data).toHaveLength(25);
  expect(parsed.data.map((event) => event.id)).toEqual(records.slice(5, 30).reverse().map((event) => event._id.toHexString()));
  expect(response.text).not.toContain("synthetic_private_body");
  expect(response.text).not.toContain("must not be returned");
  expect(response.headers["x-request-id"]).toBeTypeOf("string");
});

test("event list returns an empty result, hides foreign inboxes and rejects unsupported query input", async ({ mongo }) => {
  const { access, get, inboxId } = await setup(mongo);
  const path = `/api/v1/inboxes/${inboxId.toHexString()}/events`;
  expect((await get(path).expect(200)).body).toEqual({ data: [] });
  await get(`${path}?cursor=synthetic`).expect(400);
  await get("/api/v1/inboxes/invalid/events").expect(400);

  const Workspace = getWorkspaceModel(mongo.connection);
  const foreignWorkspace = await Workspace.create({ ownerId: access.actorId, name: "Other synthetic workspace" });
  const foreignInbox = await getInboxModel(mongo.connection).create({ workspaceId: foreignWorkspace._id, name: "Foreign synthetic inbox" });
  const foreignResponse = await get(`/api/v1/inboxes/${foreignInbox._id.toHexString()}/events`).expect(404);
  expect(apiErrorResponseSchema.parse(foreignResponse.body).error.code).toBe("NOT_FOUND");
});

test("event-list storage failures return a safe correlated 503", async ({ mongo }) => {
  const { get, inboxId } = await setup(mongo);
  await mongo.connection.close();
  const response = await get(`/api/v1/inboxes/${inboxId.toHexString()}/events`).expect(503);
  const error = apiErrorResponseSchema.parse(response.body);
  expect(error.error.code).toBe("STORAGE_UNAVAILABLE");
  expect(error.error.requestId).toBe(response.headers["x-request-id"]);
  expect(response.text).not.toContain("Mongo");
});

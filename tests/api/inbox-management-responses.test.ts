import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import express from "express";
import { Types } from "mongoose";
import pino from "pino";
import supertest, { type Response } from "supertest";
import { expect, vi } from "vitest";
import { apiErrorResponseSchema, createErrorResponse, type ApiErrorCode } from "@empiric-webhook-inbox/contracts/errors";
import { inboxSummarySchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { pageResponseSchema } from "@empiric-webhook-inbox/contracts/pagination";
import { test } from "../helpers/api-fixture.js";
import type { MongoFixture } from "../helpers/mongo-fixture.js";
import { createApp } from "../../apps/api/src/app.js";
import { connectDatabase } from "../../apps/api/src/database.js";
import { ApiError } from "../../apps/api/src/errors.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { createLocalInboxRouter } from "../../apps/api/src/routes/local-inboxes.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { createInboxService } from "../../apps/api/src/services/inboxes.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";

async function setup(mongo: MongoFixture) {
  const actorId = new Types.ObjectId(), workspaceId = new Types.ObjectId();
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: actorId, workspaceId, name: "Synthetic response workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const owner = { actorId, workspaceId };
  const access = { ...owner, apiHost: "127.0.0.1:4000", webOrigin: "http://127.0.0.1:3000" };
  const logs: string[] = [];
  const logger = pino({}, new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } }));
  const router = await createLocalInboxRouter(mongo.connection, crypto, access);
  const client = supertest(createApp(() => Promise.resolve(true), logger, router));
  const base = `/api/v1/workspaces/${workspaceId.toHexString()}/inboxes`;
  const get = (path: string) => client.get(path).set("Host", access.apiHost);
  const create = (input: unknown) => client.post(base).set("Host", access.apiHost).set("Origin", access.webOrigin).send(input as object);
  const inboxes = await createInboxService(mongo.connection, crypto);
  const tokens = createCaptureTokenService(mongo.connection, crypto);
  return { owner, access, crypto, inboxes, tokens, base, get, create, logger, logs };
}
function expectError(response: Response, code: ApiErrorCode) {
  const parsed = apiErrorResponseSchema.parse(response.body);
  expect(parsed).toEqual(createErrorResponse(code, parsed.error.requestId));
  expect(parsed.error.requestId).toBe(response.headers["x-request-id"]);
  expect(response.headers["cache-control"]).toBe("no-store");
}
function expectPrivate(response: Response, secrets: readonly string[]) {
  const serialized = JSON.stringify({ body: response.body, headers: response.headers });
  expect(secrets.some((secret) => serialized.includes(secret))).toBe(false);
}
async function expectServiceError(operation: Promise<unknown>, code: ApiErrorCode) {
  try { await operation; throw new Error("Expected mutation rejection"); }
  catch (error) {
    expect(error instanceof ApiError && error.code === code).toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
  }
}

test("HTTP creation rejects the input boundary matrix safely, then accepts normalized UTF-16 limits", async ({ mongo }) => {
  const { create, base, get, logs } = await setup(mongo);
  const marker = "synthetic-private-validation-input";
  const invalid = [[], {}, { name: null }, { name: 1 }, { name: " " }, { name: "x".repeat(101) },
    { name: "😀".repeat(50) + "x" }, { name: "bad\u0000name" }, { name: "bad\nname" }, { name: "bad\u007fname" },
    { name: { $ne: null } }, { name: "x", description: null }, { name: "x", retentionDays: "7" },
    { name: "x", description: "d".repeat(501) }, { name: "x", retentionDays: 2 },
    ...["workspaceId", "ownerId", "enabled", "tokenHash", "encryptedToken", "$set"]
      .map((key) => ({ name: "Synthetic", [key]: marker })),
  ];
  for (const input of invalid) {
    const response = await create(input).expect(400);
    expectError(response, "INVALID_REQUEST");
    expectPrivate(response, [marker]);
  }
  expect(await getInboxModel(mongo.connection).countDocuments()).toBe(0);
  const response = await create({ name: ` ${"😀".repeat(50)} `, description: "d".repeat(500), retentionDays: 30 }).expect(201);
  const created = inboxSummarySchema.parse(response.body.data);
  expect(created.name.length).toBe(100);
  expect(created.description.length).toBe(500);
  expect(created.retentionDays).toBe(30);
  expect(pageResponseSchema(inboxSummarySchema).parse((await get(base).expect(200)).body).data).toEqual([created]);
  expect(logs.join("").includes(marker)).toBe(false);
});

test("invalid rename and rejected metadata writes preserve HTTP state and recover without private errors", async ({ mongo }) => {
  const { owner, inboxes, tokens, create, get, base, logs } = await setup(mongo);
  const created = inboxSummarySchema.parse((await create({ name: "Synthetic original" }).expect(201)).body.data);
  const inboxId = new Types.ObjectId(created.id), request = { ...owner, inboxId };
  const token = await tokens.retrieveForOwner(request);
  const raw = () => mongo.connection.collection("inboxes").findOne({ _id: inboxId });
  const before = JSON.stringify(await raw());
  for (const input of [{ name: "😀".repeat(50) + "x" }, { name: "bad\u0000name" },
    { name: "bad\u007fname" }, { name: "Synthetic", updatedAt: new Date() },
    { name: "Synthetic", retentionDays: 1 }, { name: "Synthetic", description: "replacement" }]) {
    await expectServiceError(inboxes.renameForOwner(owner, inboxId, input), "INVALID_REQUEST");
  }
  const Inbox = getInboxModel(mongo.connection);
  for (const mutate of [() => inboxes.renameForOwner(owner, inboxId, { name: "Not written" }),
    () => inboxes.disableForOwner(owner, inboxId)]) {
    // Reject at the driver boundary after real query construction/validation, before any write.
    const write = vi.spyOn(Inbox.collection, "findOneAndUpdate").mockRejectedValueOnce(new Error("synthetic-private-driver-message"));
    try { await expectServiceError(mutate(), "STORAGE_UNAVAILABLE"); }
    finally { write.mockRestore(); }
    expect(JSON.stringify(await raw()) === before).toBe(true);
    const detail = await get(`/api/v1/inboxes/${created.id}`).expect(200);
    expect(detail.body).toEqual({ data: created });
    expectPrivate(detail, [token]);
  }
  const renamed = await inboxes.renameForOwner(owner, inboxId, { name: " Recovered synthetic " });
  const disabled = await inboxes.disableForOwner(owner, inboxId);
  expect(disabled.name).toBe(renamed.name);
  expect(disabled.enabled).toBe(false);
  expect(pageResponseSchema(inboxSummarySchema).parse((await get(base).expect(200)).body).data).toEqual([disabled]);
  expect(logs.join("").includes("synthetic-private-driver-message")).toBe(false);
});

test("management detail/list/HEAD remain safe and show disabled state after rename, rotation and router reload", async ({ mongo }) => {
  const { owner, access, crypto, inboxes, tokens, create, get, base, logs } = await setup(mongo);
  const created = inboxSummarySchema.parse((await create({ name: "Synthetic lifecycle" }).expect(201)).body.data);
  const inboxId = new Types.ObjectId(created.id), request = { ...owner, inboxId };
  const oldToken = await tokens.retrieveForOwner(request);
  await inboxes.renameForOwner(owner, inboxId, { name: "Renamed synthetic lifecycle" });
  await inboxes.disableForOwner(owner, inboxId);
  await tokens.rotateForOwner(request);
  const token = await tokens.retrieveForOwner(request);
  expect(await tokens.findByCaptureToken(oldToken) === null).toBe(true);
  expect((await tokens.findByCaptureToken(token))?.enabled).toBe(false);
  const expected = await inboxes.getForOwner(owner, inboxId);
  expect(expected).toMatchObject({ name: "Renamed synthetic lifecycle", enabled: false });
  const raw = await mongo.connection.collection("inboxes").findOne({ _id: inboxId });
  if (!raw) throw new Error("Expected synthetic inbox");
  const secrets = [oldToken, token, raw.tokenHash, raw.encryptedToken.ciphertext];
  const detail = await get(`/api/v1/inboxes/${created.id}`).expect(200).expect("Cache-Control", "no-store");
  expect(detail.body).toEqual({ data: expected });
  const list = await get(base).expect(200).expect("Cache-Control", "no-store");
  expect(pageResponseSchema(inboxSummarySchema).parse(list.body).data).toEqual([expected]);
  const router = await createLocalInboxRouter(mongo.connection, crypto, access);
  const reloaded = supertest(createApp(() => Promise.resolve(true), undefined, router));
  const reload = await reloaded.get(`/api/v1/inboxes/${created.id}`).set("Host", access.apiHost).expect(200);
  expect(reload.body).toEqual(detail.body);
  const head = await reloaded.head(`/api/v1/inboxes/${created.id}`).set("Host", access.apiHost).expect(200).expect("Cache-Control", "no-store");
  expect(head.text === undefined || head.text === "").toBe(true);
  for (const response of [detail, list, reload, head]) expectPrivate(response, secrets);
  expect(secrets.some((secret) => logs.join("").includes(secret))).toBe(false);
});

test("multiple token generations stay invalidated across fresh connections while another inbox stays usable", async ({ mongo }) => {
  const { owner, crypto, create, tokens } = await setup(mongo);
  const first = inboxSummarySchema.parse((await create({ name: "Synthetic rotating" }).expect(201)).body.data);
  const other = inboxSummarySchema.parse((await create({ name: "Synthetic unchanged" }).expect(201)).body.data);
  const request = { ...owner, inboxId: new Types.ObjectId(first.id) };
  const otherRequest = { ...owner, inboxId: new Types.ObjectId(other.id) };
  const old = await tokens.retrieveForOwner(request), untouched = await tokens.retrieveForOwner(otherRequest);
  await tokens.rotateForOwner(request);
  const intermediate = await tokens.retrieveForOwner(request);
  const database = await connectDatabase(mongo.uri);
  try {
    const fresh = createCaptureTokenService(database.connection, crypto);
    expect(await fresh.retrieveForOwner(request) === intermediate).toBe(true);
    await expectServiceError(fresh.requireEnabledForCapture(old), "NOT_FOUND");
    await fresh.rotateForOwner(request);
    const current = await fresh.retrieveForOwner(request);
    expect(current !== old && current !== intermediate).toBe(true);
    for (const service of [tokens, fresh]) {
      for (const stale of [old, intermediate]) await expectServiceError(service.requireEnabledForCapture(stale), "NOT_FOUND");
      expect((await service.requireEnabledForCapture(current)).inboxId.toHexString()).toBe(first.id);
      expect((await service.requireEnabledForCapture(untouched)).inboxId.toHexString()).toBe(other.id);
      expect(await service.retrieveForOwner(otherRequest) === untouched).toBe(true);
    }
  } finally { await database.close(); }
});

test("real eligibility guard maps invalid/old/missing to 404, disabled to 410 and unavailable storage to safe 503", async ({ mongo }) => {
  const { owner, create, tokens, inboxes, logger, logs } = await setup(mongo);
  const created = inboxSummarySchema.parse((await create({ name: "Synthetic eligibility" }).expect(201)).body.data);
  const request = { ...owner, inboxId: new Types.ObjectId(created.id) };
  const oldToken = await tokens.retrieveForOwner(request);
  const router = express.Router();
  // Test-only adapter: production guard + real shared response handler, not a capture receiver.
  router.get("/eligibility/:token", async (req, res) => {
    res.json({ data: await tokens.requireEnabledForCapture(req.params.token) });
  });
  const probe = supertest(createApp(() => Promise.resolve(true), logger, router));
  const resolve = (token: string) => probe.get(`/api/v1/eligibility/${token}`);
  const current = await resolve(oldToken).expect(200);
  expect(current.body.data.enabled).toBe(true);
  expect(Object.keys(current.body.data).sort()).toEqual(["inboxId", "workspaceId", "enabled", "retentionDays"].sort());
  await inboxes.disableForOwner(owner, request.inboxId);
  expectError(await resolve(oldToken).expect(410), "ENDPOINT_DISABLED");
  await tokens.rotateForOwner(request);
  const token = await tokens.retrieveForOwner(request);
  const missing = randomBytes(32).toString("base64url");
  for (const invalid of ["malformed", missing, oldToken]) expectError(await resolve(invalid).expect(404), "NOT_FOUND");
  const disabled = await resolve(token).expect(410);
  expectError(disabled, "ENDPOINT_DISABLED");
  expectPrivate(disabled, [oldToken, token]);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
  await getWorkspaceModel(mongo.connection).updateOne({ _id: owner.workspaceId }, { $set: { state: "deleting" } });
  expectError(await resolve(token).expect(404), "NOT_FOUND");
  await mongo.connection.close();
  const unavailable = await resolve(token).expect(503);
  expectError(unavailable, "STORAGE_UNAVAILABLE");
  expectPrivate(unavailable, [oldToken, token]);
  // Syntax rejection happens before storage: an outage cannot turn bad input into a DB probe.
  expectError(await resolve("malformed").expect(404), "NOT_FOUND");
  expect([oldToken, token, missing].some((secret) => logs.join("").includes(secret))).toBe(false);
  for (const invalid of [null, undefined, { $ne: null }, [token]]) {
    await expectServiceError(tokens.requireEnabledForCapture(invalid), "NOT_FOUND");
  }
});

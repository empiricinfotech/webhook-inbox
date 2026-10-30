import { expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { test } from "../helpers/api-fixture.js";
import type { MongoFixture } from "../helpers/mongo-fixture.js";
import { ApiError } from "../../apps/api/src/errors.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { createCaptureTokenCrypto, hashCaptureToken } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService, type OwnerCaptureTokenRequest } from "../../apps/api/src/services/capture-tokens.js";

async function setup(mongo: MongoFixture) {
  const Workspace = getWorkspaceModel(mongo.connection);
  const Inbox = getInboxModel(mongo.connection);
  await Inbox.createIndexes();
  const ownerId = new Types.ObjectId();
  const workspace = await Workspace.create({ ownerId, name: "Synthetic workspace" });
  const inbox = await Inbox.create({ workspaceId: workspace._id, name: "Synthetic inbox" });
  const key = randomBytes(32);
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-key", keys: new Map([["test-key", key]]) });
  const service = createCaptureTokenService(mongo.connection, crypto);
  const request = { actorId: ownerId, workspaceId: workspace._id, inboxId: inbox._id };
  return { Workspace, Inbox, ownerId, workspace, inbox, key, crypto, service, request };
}
async function failureCode(promise: Promise<unknown>) {
  try { await promise; throw new Error("Expected service rejection"); }
  catch (error) {
    expect(error instanceof ApiError).toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
    return error instanceof ApiError ? error.code : "UNEXPECTED";
  }
}

test("provisioned token resolves by hash and owner retrieval; normal reads/serialization hide credentials", async ({ mongo }) => {
  const { Inbox, service, request, key } = await setup(mongo);
  await service.issueForInbox(request);
  const token = await service.retrieveForOwner(request);
  const found = await service.findByCaptureToken(token);
  expect(found?.inboxId.equals(request.inboxId)).toBe(true);
  expect(found?.workspaceId.equals(request.workspaceId)).toBe(true);
  expect(Object.hasOwn(found!, "tokenHash")).toBe(false);
  expect(Object.hasOwn(found!, "encryptedToken")).toBe(false);
  const raw = await mongo.connection.collection("inboxes").findOne({ _id: request.inboxId });
  expect(raw?.tokenHash === hashCaptureToken(token)).toBe(true);
  expect(raw?.encryptedToken.keyVersion).toBe("test-key");
  expect(JSON.stringify(raw).includes(token)).toBe(false);
  expect(JSON.stringify(raw).includes(key.toString("hex"))).toBe(false);
  const defaultRead = await Inbox.findById(request.inboxId).lean().orFail();
  for (const field of ["tokenHash", "encryptedToken"]) expect(Object.hasOwn(defaultRead, field)).toBe(false);
  const explicitlySelected = await Inbox.findById(request.inboxId).select("+tokenHash +encryptedToken").orFail();
  expect(typeof explicitlySelected.tokenHash === "string").toBe(true);
  for (const value of [explicitlySelected.toJSON(), explicitlySelected.toObject()]) {
    for (const field of ["tokenHash", "encryptedToken"]) expect(Object.hasOwn(value, field)).toBe(false);
  }
  expect(JSON.stringify(await Inbox.find({ workspaceId: request.workspaceId })).includes(token)).toBe(false);
});

test("nonowners, mismatched scopes and absent records are denied before decryption", async ({ mongo }) => {
  const { Workspace, Inbox, service, crypto, ownerId, request } = await setup(mongo);
  await service.issueForInbox(request);
  const second = await Workspace.create({ ownerId, name: "Synthetic second workspace" });
  const secondInbox = await Inbox.create({ workspaceId: second._id, name: "Synthetic second inbox" });
  const decrypt = vi.fn(crypto.decrypt);
  const guarded = createCaptureTokenService(mongo.connection, { ...crypto, decrypt });
  for (const denied of [
    { ...request, actorId: new Types.ObjectId() },
    { ...request, workspaceId: second._id },
    { ...request, inboxId: secondInbox._id },
    { ...request, inboxId: new Types.ObjectId() },
    { ...request, workspaceId: new Types.ObjectId() },
  ]) expect(await failureCode(guarded.retrieveForOwner(denied))).toBe("NOT_FOUND");
  expect(decrypt).not.toHaveBeenCalled();
  expect(await failureCode(guarded.issueForInbox({ ...request, actorId: new Types.ObjectId() }))).toBe("NOT_FOUND");
  const invalid = { ...request, actorId: { $ne: null } } as unknown as OwnerCaptureTokenRequest;
  expect(await failureCode(guarded.retrieveForOwner(invalid))).toBe("INVALID_REQUEST");
  const expected = await service.retrieveForOwner(request);
  const nextOwner = new Types.ObjectId();
  await Workspace.updateOne({ _id: request.workspaceId }, { $set: { ownerId: nextOwner } });
  expect(await failureCode(service.retrieveForOwner(request))).toBe("NOT_FOUND");
  expect(await service.retrieveForOwner({ ...request, actorId: nextOwner }) === expected).toBe(true);
});

test("concurrent issuance provisions once and never silently rotates existing credentials", async ({ mongo }) => {
  const { service, request } = await setup(mongo);
  const results = await Promise.allSettled([service.issueForInbox(request), service.issueForInbox(request)]);
  expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason instanceof ApiError && rejected.reason.code === "CONFLICT").toBe(true);
  const token = await service.retrieveForOwner(request);
  expect(await failureCode(service.issueForInbox(request))).toBe("CONFLICT");
  expect(await service.retrieveForOwner(request) === token).toBe(true);
});

test("real unique partial hash index allows metadata-only inboxes and rejects duplicate credentials", async ({ mongo }) => {
  const { Inbox, service, request } = await setup(mongo);
  await service.issueForInbox(request);
  await Inbox.create([{ workspaceId: request.workspaceId, name: "Synthetic metadata A" },
    { workspaceId: request.workspaceId, name: "Synthetic metadata B" }]);
  const source = await Inbox.findById(request.inboxId).select("+tokenHash +encryptedToken").lean().orFail();
  if (!source.tokenHash || !source.encryptedToken) throw new Error("Expected fixture credential fields");
  let duplicateRejected = false;
  try {
    await Inbox.create({ workspaceId: request.workspaceId, name: "Synthetic duplicate",
      tokenHash: source.tokenHash, encryptedToken: source.encryptedToken });
  } catch (error) {
    duplicateRejected = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
  }
  expect(duplicateRejected).toBe(true);
  expect(await Inbox.countDocuments()).toBe(3);
});

test("lookup rejects invalid/unknown tokens, exposes disabled state and hides deleting workspaces", async ({ mongo }) => {
  const { Inbox, Workspace, service, request } = await setup(mongo);
  expect(await failureCode(service.retrieveForOwner(request))).toBe("NOT_FOUND");
  await service.issueForInbox(request);
  const token = await service.retrieveForOwner(request);
  for (const input of [null, { $ne: null }, "invalid", randomBytes(32).toString("base64url")]) {
    expect(await service.findByCaptureToken(input) === null).toBe(true);
  }
  await Inbox.updateOne({ _id: request.inboxId }, { $set: { enabled: false } }, { runValidators: true });
  expect((await service.findByCaptureToken(token))?.enabled).toBe(false);
  await Workspace.updateOne({ _id: request.workspaceId }, { $set: { state: "deleting" } }, { runValidators: true });
  expect(await service.findByCaptureToken(token) === null).toBe(true);
  expect(await failureCode(service.retrieveForOwner(request))).toBe("NOT_FOUND");
});

test("corrupted storage and wrong operator keys return safe errors without plaintext or crypto causes", async ({ mongo }) => {
  const { Inbox, crypto, service, request } = await setup(mongo);
  await service.issueForInbox(request);
  const token = await service.retrieveForOwner(request);
  const unavailable = createCaptureTokenCrypto({ currentVersion: "test-key", keys: new Map([["test-key", randomBytes(32)]]) });
  expect(await failureCode(createCaptureTokenService(mongo.connection, unavailable).retrieveForOwner(request))).toBe("INTERNAL_ERROR");
  const record = await Inbox.findById(request.inboxId).select("+tokenHash +encryptedToken").lean().orFail();
  const other = crypto.issue({ workspaceId: request.workspaceId.toHexString(), inboxId: new Types.ObjectId().toHexString() });
  // Direct writes only simulate tampering inside this fixture's private database.
  for (const replacement of [
    { tokenHash: record.tokenHash, encryptedToken: { ...record.encryptedToken, tag: "0".repeat(32) } },
    { tokenHash: other.tokenHash, encryptedToken: other.encryptedToken },
    { tokenHash: "0".repeat(64), encryptedToken: record.encryptedToken },
  ]) {
    await mongo.connection.collection("inboxes").updateOne({ _id: request.inboxId }, { $set: replacement });
    try { await service.retrieveForOwner(request); throw new Error("Expected decryption rejection"); }
    catch (error) {
      expect(error instanceof ApiError && error.code === "INTERNAL_ERROR").toBe(true);
      expect(String(error).includes(token)).toBe(false);
      expect(Object.hasOwn(error as object, "cause")).toBe(false);
    }
  }
});

test("database outage is sanitized while fixture-owned cleanup remains safe", async ({ mongo }) => {
  const { service, request } = await setup(mongo);
  await service.issueForInbox(request);
  const token = await service.retrieveForOwner(request);
  await mongo.connection.close();
  expect(await failureCode(service.findByCaptureToken(token))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(service.retrieveForOwner(request))).toBe("STORAGE_UNAVAILABLE");
});

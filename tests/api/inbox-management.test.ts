import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { expect, vi } from "vitest";
import { test } from "../helpers/api-fixture.js";
import type { MongoFixture } from "../helpers/mongo-fixture.js";
import { ApiError } from "../../apps/api/src/errors.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { CaptureTokenError, createCaptureTokenCrypto, hashCaptureToken } from "../../apps/api/src/security/capture-token.js";
import { createInboxService, type OwnerInboxRequest } from "../../apps/api/src/services/inboxes.js";
import { createCaptureTokenService, type OwnerCaptureTokenRequest } from "../../apps/api/src/services/capture-tokens.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";

async function setup(mongo: MongoFixture) {
  const actorId = new Types.ObjectId();
  const workspaceId = new Types.ObjectId();
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: actorId, workspaceId, name: "Synthetic workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const inboxes = await createInboxService(mongo.connection, crypto);
  const owner = { actorId, workspaceId };
  const created = await inboxes.createForOwner(owner, { name: "Synthetic inbox", description: "Synthetic description", retentionDays: 30 });
  const inboxId = new Types.ObjectId(created.id);
  const request = { ...owner, inboxId };
  const tokens = createCaptureTokenService(mongo.connection, crypto);
  const Inbox = getInboxModel(mongo.connection);
  const stored = () => mongo.connection.collection("inboxes").findOne({ _id: inboxId });
  return { owner, request, created, crypto, inboxes, tokens, Inbox, stored };
}
async function failureCode(operation: Promise<unknown>) {
  try { await operation; throw new Error("Expected service rejection"); }
  catch (error) {
    expect(error instanceof ApiError).toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
    return error instanceof ApiError ? error.code : "UNEXPECTED";
  }
}

test("rename and repeat disable preserve credentials/settings and return only current safe metadata", async ({ mongo }) => {
  const { owner, request, created, inboxes, tokens, stored } = await setup(mongo);
  const token = await tokens.retrieveForOwner(request);
  const before = await stored();
  const renamed = await inboxes.renameForOwner(owner, request.inboxId, { name: " Renamed synthetic " });
  expect(renamed).toMatchObject({ ...created, name: "Renamed synthetic", updatedAt: renamed.updatedAt });
  expect(Date.parse(renamed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  const disabled = await inboxes.disableForOwner(owner, request.inboxId);
  expect(disabled).toMatchObject({ ...renamed, enabled: false, updatedAt: disabled.updatedAt });
  expect(await inboxes.disableForOwner(owner, request.inboxId)).toEqual(disabled);
  expect(await inboxes.getForOwner(owner, request.inboxId)).toEqual(disabled);
  expect(await inboxes.listForOwner(owner)).toEqual([disabled]);
  const after = await stored();
  expect(after?.tokenHash === before?.tokenHash).toBe(true);
  expect(JSON.stringify(after?.encryptedToken) === JSON.stringify(before?.encryptedToken)).toBe(true);
  expect((await tokens.findByCaptureToken(token))?.enabled).toBe(false);
  expect(await tokens.retrieveForOwner(request) === token).toBe(true);
  expect(Object.keys(disabled).sort()).toEqual(Object.keys(created).sort());
  expect(JSON.stringify({ renamed, disabled }).includes(token)).toBe(false);
});

test("invalid rename input leaves persisted metadata and credentials unchanged", async ({ mongo }) => {
  const { owner, request, inboxes, stored } = await setup(mongo);
  const before = JSON.stringify(await stored());
  for (const input of [{}, { name: " " }, { name: 2 }, { name: "x".repeat(101) }, { name: "bad\nname" },
    { name: { $ne: null } }, { name: "x", enabled: true }, { name: "x", tokenHash: "injected" },
    { name: "x", workspaceId: new Types.ObjectId() }, { name: "x", $set: { enabled: true } }]) {
    expect(await failureCode(inboxes.renameForOwner(owner, request.inboxId, input))).toBe("INVALID_REQUEST");
  }
  expect(JSON.stringify(await stored()) === before).toBe(true);
  expect((await inboxes.renameForOwner(owner, request.inboxId, { name: "x".repeat(100) })).name.length).toBe(100);
});

test("all management mutations require active stored ownership, native IDs and matching inbox scope", async ({ mongo }) => {
  const { owner, request, crypto, Inbox, stored } = await setup(mongo);
  const Workspace = getWorkspaceModel(mongo.connection);
  const other = await Workspace.create({ ownerId: new Types.ObjectId(), name: "Other synthetic workspace" });
  const otherInbox = await Inbox.create({ workspaceId: other._id, name: "Other synthetic inbox" });
  const issue = vi.fn(crypto.issue);
  const inboxes = await createInboxService(mongo.connection, { ...crypto, issue });
  const tokens = createCaptureTokenService(mongo.connection, { ...crypto, issue });
  const before = JSON.stringify(await stored());
  async function denied(scope: OwnerInboxRequest, inboxId: Types.ObjectId, code: string) {
    expect(await failureCode(inboxes.renameForOwner(scope, inboxId, { name: "Denied" }))).toBe(code);
    expect(await failureCode(inboxes.disableForOwner(scope, inboxId))).toBe(code);
    expect(await failureCode(tokens.rotateForOwner({ ...scope, inboxId }))).toBe(code);
  }
  for (const input of [{ ...request, actorId: other.ownerId }, { ...request, workspaceId: other._id },
    { ...request, inboxId: otherInbox._id }, { ...request, inboxId: new Types.ObjectId() },
    { ...request, workspaceId: new Types.ObjectId() },
    { actorId: other.ownerId, workspaceId: other._id, inboxId: request.inboxId }]) {
    await denied(input, input.inboxId, "NOT_FOUND");
  }
  for (const key of ["actorId", "workspaceId", "inboxId"]) {
    const invalid = { ...request, [key]: { $ne: null } } as unknown as OwnerCaptureTokenRequest;
    await denied(invalid, invalid.inboxId, "INVALID_REQUEST");
  }
  await Workspace.updateOne({ _id: owner.workspaceId }, { $set: { ownerId: other.ownerId } });
  await denied(owner, request.inboxId, "NOT_FOUND");
  await Workspace.updateOne({ _id: owner.workspaceId }, { $set: { ownerId: owner.actorId, state: "deleting" } });
  await denied(owner, request.inboxId, "NOT_FOUND");
  expect(issue).not.toHaveBeenCalled();
  expect(JSON.stringify(await stored()) === before).toBe(true);
});

test("rotation invalidates the old token, retains disabled state and releases no credential", async ({ mongo }) => {
  const { owner, request, created, inboxes, tokens, stored } = await setup(mongo);
  const oldToken = await tokens.retrieveForOwner(request);
  const before = await stored();
  await inboxes.disableForOwner(owner, request.inboxId);
  expect(await tokens.rotateForOwner(request)).toBeUndefined();
  const token = await tokens.retrieveForOwner(request);
  expect(token !== oldToken && hashCaptureToken(token) !== null).toBe(true);
  expect(await tokens.findByCaptureToken(oldToken) === null).toBe(true);
  const lookup = await tokens.findByCaptureToken(token);
  expect(lookup?.inboxId.equals(request.inboxId)).toBe(true);
  expect(lookup?.enabled).toBe(false);
  const renamed = await inboxes.renameForOwner(owner, request.inboxId, { name: "Still disabled" });
  expect(renamed).toMatchObject({ ...created, name: "Still disabled", enabled: false, updatedAt: renamed.updatedAt });
  const after = await stored();
  expect(after?.tokenHash === hashCaptureToken(token)).toBe(true);
  expect(after?.tokenHash !== before?.tokenHash).toBe(true);
  expect(after?.encryptedToken.nonce !== before?.encryptedToken.nonce).toBe(true);
  expect(JSON.stringify({ after, renamed, lookup }).includes(token)).toBe(false);
  expect(Object.keys(renamed).sort()).toEqual(Object.keys(created).sort());
});

test("failed rotation is atomic for crypto, validation, unique collision and write failure; recovery succeeds", async ({ mongo }) => {
  const { owner, request, crypto, inboxes, tokens, Inbox, stored } = await setup(mongo);
  const oldToken = await tokens.retrieveForOwner(request);
  const before = await stored();
  const other = await inboxes.createForOwner(owner, { name: "Collision fixture" });
  const collision = await Inbox.findById(other.id).select("+tokenHash +encryptedToken").lean().orFail();
  if (!before?.tokenHash || !before.encryptedToken || !collision.tokenHash || !collision.encryptedToken) {
    throw new Error("Expected fixture credential pairs");
  }
  const valid = crypto.issue({ workspaceId: owner.workspaceId.toHexString(), inboxId: request.inboxId.toHexString() });
  const scenarios = [
    { issue: () => { throw new CaptureTokenError(); }, code: "INTERNAL_ERROR" },
    { issue: () => ({ tokenHash: before.tokenHash, encryptedToken: before.encryptedToken }), code: "CONFLICT" },
    { issue: () => ({ tokenHash: collision.tokenHash!, encryptedToken: collision.encryptedToken! }), code: "CONFLICT" },
    { issue: () => ({ ...valid, encryptedToken: { ...valid.encryptedToken, nonce: "invalid" } }), code: "INVALID_REQUEST" },
  ];
  for (const scenario of scenarios) {
    const failed = createCaptureTokenService(mongo.connection, { ...crypto, issue: scenario.issue });
    expect(await failureCode(failed.rotateForOwner(request))).toBe(scenario.code);
    expect(JSON.stringify(await stored()) === JSON.stringify(before)).toBe(true);
    expect(await tokens.retrieveForOwner(request) === oldToken).toBe(true);
  }
  const write = vi.spyOn(Inbox, "updateOne").mockRejectedValueOnce(new Error("synthetic-private-write-message"));
  expect(await failureCode(tokens.rotateForOwner(request))).toBe("STORAGE_UNAVAILABLE");
  write.mockRestore();
  expect(JSON.stringify(await stored()) === JSON.stringify(before)).toBe(true);
  await tokens.rotateForOwner(request);
  expect(await tokens.findByCaptureToken(oldToken) === null).toBe(true);
  expect((await tokens.findByCaptureToken(await tokens.retrieveForOwner(request)))?.inboxId.equals(request.inboxId)).toBe(true);
});

test("concurrent rotations of one generation have one winner and no partially replaced credential", async ({ mongo }) => {
  const { request, tokens, Inbox } = await setup(mongo);
  const oldToken = await tokens.retrieveForOwner(request);
  const original = Inbox.updateOne.bind(Inbox);
  const gate = Promise.withResolvers<void>();
  const timeout = setTimeout(() => gate.reject(new Error("Rotation test barrier timed out")), 3000);
  let arrivals = 0;
  // Delay execution, not results: both real reads finish before either real Mongo update.
  const write = vi.spyOn(Inbox, "updateOne").mockImplementation((filter, update, options) => {
    const query = original(filter, update, options);
    const exec = query.exec.bind(query);
    query.exec = async () => {
      if (++arrivals === 2) gate.resolve();
      await gate.promise;
      return exec();
    };
    return query;
  });
  try {
    const results = await Promise.allSettled([tokens.rotateForOwner(request), tokens.rotateForOwner(request)]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason instanceof ApiError && rejected.reason.code === "CONFLICT").toBe(true);
  } finally { clearTimeout(timeout); write.mockRestore(); }
  expect(arrivals).toBe(2);
  const token = await tokens.retrieveForOwner(request);
  expect(token !== oldToken).toBe(true);
  expect(await tokens.findByCaptureToken(oldToken) === null).toBe(true);
  expect((await tokens.findByCaptureToken(token))?.inboxId.equals(request.inboxId)).toBe(true);
});

test("rotation does not provision legacy records; closed storage returns safe errors for every mutation", async ({ mongo }) => {
  const { owner, request, inboxes, tokens, Inbox } = await setup(mongo);
  const legacy = await Inbox.create({ workspaceId: owner.workspaceId, name: "Legacy synthetic metadata" });
  expect(await failureCode(tokens.rotateForOwner({ ...owner, inboxId: legacy._id }))).toBe("CONFLICT");
  const unissued = await Inbox.findById(legacy._id).select("+tokenHash +encryptedToken").lean().orFail();
  expect(unissued.tokenHash === undefined && unissued.encryptedToken === undefined).toBe(true);
  await mongo.connection.close();
  expect(await failureCode(inboxes.renameForOwner(owner, request.inboxId, { name: "Denied" }))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(inboxes.disableForOwner(owner, request.inboxId))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(tokens.rotateForOwner(request))).toBe("STORAGE_UNAVAILABLE");
});

test("explicit owner rotation writes with the current key without needing to decrypt the old credential", async ({ mongo }) => {
  const { request, tokens, stored } = await setup(mongo);
  const oldToken = await tokens.retrieveForOwner(request);
  const current = createCaptureTokenCrypto({ currentVersion: "test-v2", keys: new Map([["test-v2", randomBytes(32)]]) });
  const replacement = createCaptureTokenService(mongo.connection, current);
  expect(await failureCode(replacement.retrieveForOwner(request))).toBe("INTERNAL_ERROR");
  await replacement.rotateForOwner(request);
  const token = await replacement.retrieveForOwner(request);
  expect(token !== oldToken).toBe(true);
  expect((await stored())?.encryptedToken.keyVersion).toBe("test-v2");
  expect(await replacement.findByCaptureToken(oldToken) === null).toBe(true);
  expect((await replacement.findByCaptureToken(token))?.inboxId.equals(request.inboxId)).toBe(true);
});

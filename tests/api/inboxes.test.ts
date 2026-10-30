import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { expect, vi } from "vitest";
import { test } from "../helpers/api-fixture.js";
import { ApiError } from "../../apps/api/src/errors.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";
import { createCaptureTokenCrypto, CaptureTokenError, hashCaptureToken } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";
import { createInboxService, type OwnerInboxRequest } from "../../apps/api/src/services/inboxes.js";

async function failureCode(promise: Promise<unknown>) {
  try { await promise; throw new Error("Expected rejection"); }
  catch (error) {
    expect(error instanceof ApiError).toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
    return error instanceof ApiError ? error.code : "UNEXPECTED";
  }
}
function crypto() {
  return createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
}
function bootstrapRequest() { return { ownerId: new Types.ObjectId(), workspaceId: new Types.ObjectId(), name: "Synthetic workspace" }; }

test("local bootstrap is repeatable/concurrent and never changes existing owner, name or timestamps", async ({ mongo }) => {
  const request = bootstrapRequest();
  expect(await failureCode(bootstrapLocalWorkspace(mongo.connection, { ...request, name: "bad\nname" }))).toBe("INVALID_REQUEST");
  const invalid = { ...request, ownerId: { $ne: null } } as unknown as typeof request;
  expect(await failureCode(bootstrapLocalWorkspace(mongo.connection, invalid))).toBe("INVALID_REQUEST");
  const results = await Promise.all(Array.from({ length: 4 }, () => bootstrapLocalWorkspace(mongo.connection, request)));
  expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
  const Workspace = getWorkspaceModel(mongo.connection);
  expect(await Workspace.countDocuments()).toBe(1);
  expect(await bootstrapLocalWorkspace(mongo.connection, { ...request, name: "Changed" })).toEqual(results[0]);
  expect(await failureCode(bootstrapLocalWorkspace(mongo.connection, { ...request, ownerId: new Types.ObjectId() }))).toBe("CONFLICT");
  await Workspace.updateOne({ _id: request.workspaceId }, { $set: { state: "deleting" } });
  expect(await failureCode(bootstrapLocalWorkspace(mongo.connection, request))).toBe("CONFLICT");
  expect(await Workspace.countDocuments()).toBe(1);
});

test("created inbox is credentialed in one insert; owner retrieval/lookup work and DTO lists omit all secrets", async ({ mongo }) => {
  const request = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, request);
  const tokenCrypto = crypto();
  const inboxes = await createInboxService(mongo.connection, tokenCrypto);
  const owner = { actorId: request.ownerId, workspaceId: request.workspaceId };
  expect(await inboxes.listForOwner(owner)).toEqual([]);
  const created = await inboxes.createForOwner(owner, { name: " Synthetic inbox ", description: " synthetic ", retentionDays: 1 });
  expect(created).toMatchObject({ name: "Synthetic inbox", description: "synthetic", retentionDays: 1, enabled: true });
  expect(created.workspaceId).toBe(request.workspaceId.toHexString());
  expect(Number.isFinite(Date.parse(created.createdAt))).toBe(true);
  const tokens = createCaptureTokenService(mongo.connection, tokenCrypto);
  const token = await tokens.retrieveForOwner({ ...owner, inboxId: new Types.ObjectId(created.id) });
  expect(hashCaptureToken(token) !== null).toBe(true);
  expect((await tokens.findByCaptureToken(token))?.inboxId.toHexString()).toBe(created.id);
  const stored = await mongo.connection.collection("inboxes").findOne({ _id: new Types.ObjectId(created.id) });
  expect(stored?.tokenHash === hashCaptureToken(token)).toBe(true);
  const list = await inboxes.listForOwner(owner);
  expect(list).toEqual([created]);
  expect(Object.keys(created).sort()).toEqual(["id", "workspaceId", "name", "description", "enabled", "retentionDays", "createdAt", "updatedAt"].sort());
  expect(JSON.stringify({ created, list, stored }).includes(token)).toBe(false);
  const indexes = await getInboxModel(mongo.connection).collection.indexes();
  expect(indexes.some((index) => index.key.tokenHash === 1 && index.unique)).toBe(true);
});

test("creation/list enforce active stored ownership, native IDs and workspace isolation before issuing credentials", async ({ mongo }) => {
  const request = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, request);
  const other = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, other);
  const tokenCrypto = crypto();
  const issue = vi.fn(tokenCrypto.issue);
  const inboxes = await createInboxService(mongo.connection, { ...tokenCrypto, issue });
  const owner = { actorId: request.ownerId, workspaceId: request.workspaceId };
  for (const denied of [{ ...owner, actorId: other.ownerId }, { ...owner, workspaceId: other.workspaceId },
    { ...owner, workspaceId: new Types.ObjectId() }]) {
    expect(await failureCode(inboxes.createForOwner(denied, { name: "Denied" }))).toBe("NOT_FOUND");
    expect(await failureCode(inboxes.listForOwner(denied))).toBe("NOT_FOUND");
  }
  const invalid = { ...owner, workspaceId: { $ne: null } } as unknown as OwnerInboxRequest;
  expect(await failureCode(inboxes.createForOwner(invalid, { name: "Denied" }))).toBe("INVALID_REQUEST");
  expect(issue).not.toHaveBeenCalled();
  await inboxes.createForOwner(owner, { name: "Visible" });
  expect(await inboxes.listForOwner({ actorId: other.ownerId, workspaceId: other.workspaceId })).toEqual([]);
  await getWorkspaceModel(mongo.connection).updateOne({ _id: request.workspaceId }, { $set: { state: "deleting" } });
  expect(await failureCode(inboxes.createForOwner(owner, { name: "Denied" }))).toBe("NOT_FOUND");
  expect(await failureCode(inboxes.listForOwner(owner))).toBe("NOT_FOUND");
  expect(await getInboxModel(mongo.connection).countDocuments()).toBe(1);
});

test("invalid or injected input and crypto/index/insert failures leave no partially created inbox", async ({ mongo }) => {
  const request = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, request);
  const owner = { actorId: request.ownerId, workspaceId: request.workspaceId };
  const tokenCrypto = crypto();
  const inboxes = await createInboxService(mongo.connection, tokenCrypto);
  const Inbox = getInboxModel(mongo.connection);
  for (const input of [{ name: "" }, { name: "x", workspaceId: new Types.ObjectId() },
    { name: "x", tokenHash: "injected" }, { name: "x", enabled: false }, { name: "x", retentionDays: 90 }]) {
    expect(await failureCode(inboxes.createForOwner(owner, input))).toBe("INVALID_REQUEST");
  }
  const broken = await createInboxService(mongo.connection, { ...tokenCrypto, issue: () => { throw new CaptureTokenError(); } });
  expect(await failureCode(broken.createForOwner(owner, { name: "Denied" }))).toBe("INTERNAL_ERROR");
  const insert = vi.spyOn(Inbox, "create").mockRejectedValueOnce(new Error("synthetic-private-driver-message"));
  expect(await failureCode(inboxes.createForOwner(owner, { name: "Denied" }))).toBe("STORAGE_UNAVAILABLE");
  insert.mockRestore();
  expect(await Inbox.countDocuments()).toBe(0);
  const indexes = vi.spyOn(Inbox, "createIndexes").mockRejectedValueOnce(new Error("synthetic-private-index-message"));
  expect(await failureCode(createInboxService(mongo.connection, tokenCrypto))).toBe("STORAGE_UNAVAILABLE");
  indexes.mockRestore();
});

test("real unique hash collisions fail safely; separate creations have distinct credentials and deterministic list ordering", async ({ mongo }) => {
  const request = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, request);
  const owner = { actorId: request.ownerId, workspaceId: request.workspaceId };
  const tokenCrypto = crypto();
  const fixed = tokenCrypto.issue({ workspaceId: request.workspaceId.toHexString(), inboxId: new Types.ObjectId().toHexString() });
  const colliding = await createInboxService(mongo.connection, { ...tokenCrypto, issue: () => fixed });
  await colliding.createForOwner(owner, { name: "Collision source" });
  expect(await failureCode(colliding.createForOwner(owner, { name: "Collision rejected" }))).toBe("CONFLICT");
  const inboxes = await createInboxService(mongo.connection, tokenCrypto);
  await Promise.all(Array.from({ length: 3 }, (_, n) => inboxes.createForOwner(owner, { name: `Synthetic ${n}` })));
  const records = await mongo.connection.collection("inboxes").find({}).toArray();
  expect(records.length).toBe(4);
  expect(new Set(records.map((record) => record.tokenHash)).size).toBe(4);
  const list = await inboxes.listForOwner(owner);
  const expected = records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.toHexString().localeCompare(a._id.toHexString()));
  expect(list.map((record) => record.id)).toEqual(expected.map((record) => record._id.toHexString()));
});

test("closed storage fails safely for bootstrap, service initialization, creation and list", async ({ mongo }) => {
  const request = bootstrapRequest();
  await bootstrapLocalWorkspace(mongo.connection, request);
  const inboxes = await createInboxService(mongo.connection, crypto());
  await mongo.connection.close();
  const owner = { actorId: request.ownerId, workspaceId: request.workspaceId };
  expect(await failureCode(bootstrapLocalWorkspace(mongo.connection, request))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(createInboxService(mongo.connection, crypto()))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(inboxes.createForOwner(owner, { name: "Denied" }))).toBe("STORAGE_UNAVAILABLE");
  expect(await failureCode(inboxes.listForOwner(owner))).toBe("STORAGE_UNAVAILABLE");
});

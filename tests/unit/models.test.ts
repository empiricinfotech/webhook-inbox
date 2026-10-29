import { afterAll, expect, test } from "vitest";
import mongoose, { Types } from "mongoose";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";

const connection = mongoose.createConnection();
afterAll(() => connection.close());
const Workspace = getWorkspaceModel(connection);
const Inbox = getInboxModel(connection);
const ownerId = new Types.ObjectId();
const workspaceId = new Types.ObjectId();

// No Mongo process or global Mongoose configuration is used by these checks.
test("models compile idempotently on the supplied disconnected connection", () => {
  expect(getWorkspaceModel(connection)).toBe(Workspace);
  expect(getInboxModel(connection)).toBe(Inbox);
  expect(Workspace.db).toBe(connection);
  expect(Inbox.db).toBe(connection);
  expect(mongoose.connection.models.Workspace).toBeUndefined();
  expect(mongoose.connection.models.Inbox).toBeUndefined();
  expect(connection.readyState).toBe(0);
});

test("valid metadata is trimmed, bounded and receives explicit defaults", async () => {
  const workspace = new Workspace({ ownerId, name: "  Synthetic workspace  " });
  await expect(workspace.validate()).resolves.toBeUndefined();
  expect(workspace.name).toBe("Synthetic workspace");
  expect(workspace.state).toBe("active");
  const inbox = new Inbox({ workspaceId, name: "  Synthetic inbox  ", description: "  Synthetic notes\nline two  " });
  await expect(inbox.validate()).resolves.toBeUndefined();
  expect(inbox.name).toBe("Synthetic inbox");
  expect(inbox.description).toBe("Synthetic notes\nline two");
  expect(inbox.enabled).toBe(true);
  expect(inbox.retentionDays).toBe(7);
  expect(new Inbox({ workspaceId, name: "Synthetic" }).description).toBe("");
  await expect(new Workspace({ ownerId, name: "x".repeat(100), state: "deleting" }).validate()).resolves.toBeUndefined();
  for (const retentionDays of [1, 7, 30]) {
    await expect(new Inbox({ workspaceId, name: "x".repeat(100), description: "x".repeat(500),
      retentionDays, enabled: false }).validate()).resolves.toBeUndefined();
  }
});

test("workspace required fields, types, length and lifecycle are validated without coercion", async () => {
  for (const patch of [
    { name: undefined }, { name: null }, { name: "  " }, { name: "x".repeat(101) },
    { name: 42 }, { name: true }, { name: {} }, { name: ["Synthetic"] },
    { name: "Synthetic\nworkspace" }, { name: "Synthetic\u0000workspace" },
    { ownerId: undefined }, { ownerId: null }, { ownerId: "invalid" }, { ownerId: ownerId.toHexString() },
    { ownerId: { $ne: null } }, { state: "unknown" }, { state: null }, { state: 1 },
  ]) {
    await expect(new Workspace({ ownerId, name: "Synthetic", ...patch }).validate())
      .rejects.toBeInstanceOf(mongoose.Error.ValidationError);
  }
});

test("inbox rejects invalid references, scalar coercion, lengths, controls and retention choices", async () => {
  for (const patch of [
    { workspaceId: undefined }, { workspaceId: null }, { workspaceId: workspaceId.toHexString() },
    { workspaceId: { $ne: null } }, { name: undefined }, { name: null }, { name: " " },
    { name: "x".repeat(101) }, { name: 4 }, { name: ["Synthetic"] }, { name: "a\tb" },
    { description: "x".repeat(501) }, { description: null }, { description: 1 },
    { description: ["notes"] }, { description: { $gt: "" } }, { description: "a\u0000b" },
    { enabled: null }, { enabled: "true" }, { enabled: 1 }, { enabled: {} },
    { retentionDays: null }, { retentionDays: "7" }, { retentionDays: 0 },
    { retentionDays: 8 }, { retentionDays: 1.5 }, { retentionDays: Number.NaN },
    { retentionDays: Number.POSITIVE_INFINITY }, { retentionDays: [7] },
  ]) {
    await expect(new Inbox({ workspaceId, name: "Synthetic", ...patch }).validate())
      .rejects.toBeInstanceOf(mongoose.Error.ValidationError);
  }
});

test("strict schemas reject unexpected fields and premature secret fields", () => {
  expect(() => new Workspace({ ownerId, name: "Synthetic", extra: true })).toThrow(mongoose.Error.StrictModeError);
  for (const field of ["extra", "token", "tokenHash", "encryptedToken", "verificationConfig"]) {
    expect(() => new Inbox({ workspaceId, name: "Synthetic", [field]: "synthetic" }))
      .toThrow(mongoose.Error.StrictModeError);
  }
});

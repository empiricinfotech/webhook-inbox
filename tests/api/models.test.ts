import { expect } from "vitest";
import { Types } from "mongoose";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "../helpers/api-fixture.js";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";

const ownerId = new Types.ObjectId();

test("workspace and inbox persist ObjectIds and timestamps; save updates only updatedAt", async ({ mongo }) => {
  const Workspace = getWorkspaceModel(mongo.connection);
  const Inbox = getInboxModel(mongo.connection);
  const workspace = await Workspace.create({ ownerId, name: " Synthetic workspace " });
  const inbox = await Inbox.create({ workspaceId: workspace._id, name: " Synthetic inbox " });
  expect(workspace.createdAt).toBeInstanceOf(Date);
  expect(workspace.updatedAt).toEqual(workspace.createdAt);
  expect(inbox.createdAt).toBeInstanceOf(Date);
  expect(inbox.updatedAt).toEqual(inbox.createdAt);
  const before = inbox.createdAt.getTime();
  const workspaceCreated = workspace.createdAt.getTime();
  // Cross a clock tick so an unchanged updatedAt cannot satisfy this assertion.
  await delay(2);
  workspace.name = "Renamed synthetic workspace";
  await workspace.save();
  expect(workspace.createdAt.getTime()).toBe(workspaceCreated);
  expect(workspace.updatedAt.getTime()).toBeGreaterThan(workspaceCreated);
  inbox.name = "Renamed synthetic inbox";
  await inbox.save();
  const stored = await Inbox.findOne({ _id: inbox._id, workspaceId: workspace._id }).orFail();
  expect(stored.name).toBe("Renamed synthetic inbox");
  expect(stored.createdAt.getTime()).toBe(before);
  expect(stored.updatedAt.getTime()).toBeGreaterThan(before);
  expect(stored.workspaceId).toBeInstanceOf(Types.ObjectId);
  expect((await Workspace.findById(workspace._id).orFail()).ownerId.equals(ownerId)).toBe(true);
  expect(await mongo.connection.db!.collection("inboxes").findOne({ _id: inbox._id }))
    .toMatchObject({ name: "Renamed synthetic inbox", enabled: true, retentionDays: 7 });
});

test("invalid document saves reject without inserting or overwriting persisted metadata", async ({ mongo }) => {
  const Workspace = getWorkspaceModel(mongo.connection);
  const Inbox = getInboxModel(mongo.connection);
  await expect(Workspace.create({ ownerId, name: " " })).rejects.toThrow();
  await expect(new Inbox({ workspaceId: new Types.ObjectId(), name: "Synthetic", retentionDays: 8 }).save()).rejects.toThrow();
  expect(await Workspace.countDocuments()).toBe(0);
  expect(await Inbox.countDocuments()).toBe(0);
  const workspace = await Workspace.create({ ownerId, name: "Synthetic workspace" });
  const inbox = await Inbox.create({ workspaceId: workspace._id, name: "Synthetic inbox" });
  inbox.set("retentionDays", 8);
  await expect(inbox.save()).rejects.toThrow();
  expect((await Inbox.findById(inbox._id).orFail()).retentionDays).toBe(7);
  workspace.name = " ";
  await expect(workspace.save()).rejects.toThrow();
  expect((await Workspace.findById(workspace._id).orFail()).name).toBe("Synthetic workspace");
});

test("scoped indexes are built explicitly and metadata is queryable within a workspace", async ({ mongo }) => {
  const Workspace = getWorkspaceModel(mongo.connection);
  const Inbox = getInboxModel(mongo.connection);
  await Workspace.createIndexes();
  await Inbox.createIndexes();
  expect((await Workspace.listIndexes()).some((index) => JSON.stringify(index.key) === JSON.stringify({ ownerId: 1, createdAt: -1, _id: -1 }))).toBe(true);
  expect((await Inbox.listIndexes()).some((index) => JSON.stringify(index.key) === JSON.stringify({ workspaceId: 1, createdAt: -1, _id: -1 }))).toBe(true);
  const first = await Workspace.create({ ownerId, name: "Synthetic A" });
  const second = await Workspace.create({ ownerId, name: "Synthetic B" });
  await Inbox.create([{ workspaceId: first._id, name: "Synthetic inbox" },
    { workspaceId: second._id, name: "Synthetic inbox" }]);
  expect(await Inbox.countDocuments({ workspaceId: first._id })).toBe(1);
  expect(await Inbox.countDocuments({ workspaceId: second._id })).toBe(1);
  // Same display names are allowed; this query is data-shape evidence, not authorization.
});

test("query updates validate when requested and cannot change the inbox workspace reference", async ({ mongo }) => {
  const Workspace = getWorkspaceModel(mongo.connection);
  const Inbox = getInboxModel(mongo.connection);
  const workspace = await Workspace.create({ ownerId, name: "Synthetic workspace" });
  const inbox = await Inbox.create({ workspaceId: workspace._id, name: "Synthetic inbox" });
  await expect(Inbox.updateOne({ _id: inbox._id }, { $set: { retentionDays: 8 } }, { runValidators: true, strict: "throw" }))
    .rejects.toThrow();
  await expect(Inbox.updateOne({ _id: inbox._id }, { $set: { workspaceId: new Types.ObjectId() } }, { runValidators: true, strict: "throw" }))
    .rejects.toThrow();
  await expect(Inbox.find({ unknownScope: workspace._id }).exec()).rejects.toThrow();
  expect((await Inbox.findById(inbox._id).orFail()).workspaceId.equals(workspace._id)).toBe(true);
  expect((await Inbox.findById(inbox._id).orFail()).retentionDays).toBe(7);
});

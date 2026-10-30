import { z } from "zod";
import { paginationQuerySchema } from "@empiric-webhook-inbox/contracts/pagination";
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { Types, type Connection } from "mongoose";
import { createInboxSchema, inboxSummarySchema, type InboxSummary } from "@empiric-webhook-inbox/contracts/inboxes";
import { ApiError } from "../errors.js";
import { getInboxModel, type Inbox as InboxRecord } from "../models/inbox.js";
import { getWorkspaceModel } from "../models/workspace.js";
import type { CaptureTokenCrypto } from "../security/capture-token.js";
import { safeStorageOperation } from "./storage-operation.js";

export interface OwnerInboxRequest { actorId: Types.ObjectId; workspaceId: Types.ObjectId }
function summary(inbox: InboxRecord & { _id: Types.ObjectId }): InboxSummary {
  return inboxSummarySchema.parse({
    id: inbox._id.toHexString(), workspaceId: inbox.workspaceId.toHexString(),
    name: inbox.name, description: inbox.description, enabled: inbox.enabled, retentionDays: inbox.retentionDays,
    createdAt: inbox.createdAt.toISOString(), updatedAt: inbox.updatedAt.toISOString(),
  });
}

// Must be awaited: creation is unavailable until declared indexes exist. No syncIndexes/drop.
export function createInboxService(connection: Connection, crypto: CaptureTokenCrypto) {
  return safeStorageOperation(async () => {
    const Inbox = getInboxModel(connection);
    const Workspace = getWorkspaceModel(connection);
    await Inbox.createIndexes();
    async function requireOwner(request: OwnerInboxRequest) {
      if (!(request?.actorId instanceof Types.ObjectId) || !(request?.workspaceId instanceof Types.ObjectId)) {
        throw new ApiError("INVALID_REQUEST");
      }
      if (!await Workspace.exists({ _id: request.workspaceId, ownerId: request.actorId, state: "active" })) {
        throw new ApiError("NOT_FOUND");
      }
    }
    const cursorSchema = z.tuple([identifierSchema, z.iso.datetime(), identifierSchema]);
    return Object.freeze({
      getForOwner(request: OwnerInboxRequest, inboxId: Types.ObjectId): Promise<InboxSummary> {
        return safeStorageOperation(async () => {
          await requireOwner(request);
          if (!(inboxId instanceof Types.ObjectId)) throw new ApiError("INVALID_REQUEST");
          const inbox = await Inbox.findOne({ _id: inboxId, workspaceId: request.workspaceId }).lean().exec();
          if (!inbox) throw new ApiError("NOT_FOUND");
          return summary(inbox);
        });
      },
      pageForOwner(request: OwnerInboxRequest, input: unknown) {
        return safeStorageOperation(async () => {
          await requireOwner(request);
          const parsed = paginationQuerySchema.safeParse(input);
          if (!parsed.success) throw new ApiError("INVALID_REQUEST");
          const { limit, cursor } = parsed.data;
          let after: { createdAt: Date; id: Types.ObjectId } | undefined;
          if (cursor) {
            try {
              const decoded = Buffer.from(cursor, "base64url");
              if (decoded.toString("base64url") !== cursor) throw new Error();
              const [workspace, date, id] = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
              if (workspace !== request.workspaceId.toHexString()) throw new Error();
              after = { createdAt: new Date(date), id: new Types.ObjectId(id) };
            } catch { throw new ApiError("INVALID_REQUEST"); }
          }
          const inboxes = await Inbox.find({ workspaceId: request.workspaceId, ...(after ? { $or: [
            { createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, _id: { $lt: after.id } },
          ] } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean().exec();
          const data = inboxes.slice(0, limit).map(summary);
          const last = data.at(-1);
          const nextCursor = inboxes.length > limit && last
            ? Buffer.from(JSON.stringify([last.workspaceId, last.createdAt, last.id])).toString("base64url") : null;
          return { data, nextCursor };
        });
      },
      createForOwner(request: OwnerInboxRequest, input: unknown): Promise<InboxSummary> {
        return safeStorageOperation(async () => {
          await requireOwner(request);
          const parsed = createInboxSchema.safeParse(input);
          if (!parsed.success) throw new ApiError("INVALID_REQUEST");
          const id = new Types.ObjectId();
          const credential = crypto.issue({ workspaceId: request.workspaceId.toHexString(), inboxId: id.toHexString() });
          // One document insert: a failed crypto/validation/write cannot leave a tokenless inbox.
          const inbox = await Inbox.create({ _id: id, workspaceId: request.workspaceId, ...parsed.data, ...credential });
          return summary(inbox);
        });
      },
      listForOwner(request: OwnerInboxRequest): Promise<InboxSummary[]> {
        return safeStorageOperation(async () => {
          await requireOwner(request);
          const inboxes = await Inbox.find({ workspaceId: request.workspaceId })
            .select("_id workspaceId name description enabled retentionDays createdAt updatedAt")
            .sort({ createdAt: -1, _id: -1 }).lean().exec();
          return inboxes.map(summary);
        });
      },
    });
  });
}

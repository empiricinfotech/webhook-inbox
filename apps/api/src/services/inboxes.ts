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
    return Object.freeze({
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

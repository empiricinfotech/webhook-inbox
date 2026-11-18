import { Types, type Connection } from "mongoose";
import { DEFAULT_EVENT_LIST_LIMIT, inboxEventSummarySchema } from "@empiric-webhook-inbox/contracts/events";
import { ApiError } from "../errors.js";
import { getInboxModel } from "../models/inbox.js";
import { getWorkspaceModel } from "../models/workspace.js";
import { safeStorageOperation } from "./storage-operation.js";
import type { OwnerInboxRequest } from "./inboxes.js";

export function createInboxEventService(connection: Connection) {
  const events = connection.collection("events");
  const Inbox = getInboxModel(connection);
  const Workspace = getWorkspaceModel(connection);

  return {
    listForOwner(request: OwnerInboxRequest, inboxId: Types.ObjectId) {
      return safeStorageOperation(async () => {
        if (!(request?.actorId instanceof Types.ObjectId) || !(request?.workspaceId instanceof Types.ObjectId)
          || !(inboxId instanceof Types.ObjectId)) throw new ApiError("INVALID_REQUEST");
        const owner = await Workspace.exists({ _id: request.workspaceId, ownerId: request.actorId, state: "active" });
        if (!owner || !await Inbox.exists({ _id: inboxId, workspaceId: request.workspaceId })) throw new ApiError("NOT_FOUND");

        const stored = await events.find({ workspaceId: request.workspaceId, inboxId }, {
          projection: { _id: 1, receivedAt: 1, method: 1, receivedBytes: 1, contentType: 1,
            format: 1, parseFailed: 1, signatureState: 1 },
        }).sort({ receivedAt: -1, _id: -1 }).limit(DEFAULT_EVENT_LIST_LIMIT).toArray();
        const data = stored.map((event) => inboxEventSummarySchema.parse({
          id: event._id.toHexString(), receivedAt: event.receivedAt.toISOString(), method: event.method,
          receivedBytes: event.receivedBytes, contentType: event.contentType, format: event.format,
          parseFailed: event.parseFailed, signatureState: event.signatureState,
        }));
        return { data };
      });
    },
  };
}

import { Types, type Connection } from "mongoose";
import { ApiError } from "../errors.js";
import { getInboxModel } from "../models/inbox.js";
import { getWorkspaceModel } from "../models/workspace.js";
import { hashCaptureToken, type CaptureTokenCrypto } from "../security/capture-token.js";
import { safeStorageOperation } from "./storage-operation.js";

export interface OwnerCaptureTokenRequest {
  actorId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  inboxId: Types.ObjectId;
}

// Internal service only. The eventual transport must supply a trusted actor;
// accepting an actor ID here does not implement session authentication.
export function createCaptureTokenService(connection: Connection, crypto: CaptureTokenCrypto) {
  const Inbox = getInboxModel(connection);
  const Workspace = getWorkspaceModel(connection);
  async function requireOwner(request: OwnerCaptureTokenRequest) {
    if (!request || ![request.actorId, request.workspaceId, request.inboxId]
      .every((id) => id instanceof Types.ObjectId)) throw new ApiError("INVALID_REQUEST");
    const owner = await Workspace.exists({ _id: request.workspaceId, ownerId: request.actorId, state: "active" });
    if (!owner) throw new ApiError("NOT_FOUND");
  }
  return Object.freeze({
    // Provision an existing metadata record once; never replace existing credentials.
    issueForInbox(request: OwnerCaptureTokenRequest): Promise<void> {
      return safeStorageOperation(async () => {
        await requireOwner(request);
        if (!await Inbox.exists({ _id: request.inboxId, workspaceId: request.workspaceId })) {
          throw new ApiError("NOT_FOUND");
        }
        const credential = crypto.issue({ workspaceId: request.workspaceId.toHexString(), inboxId: request.inboxId.toHexString() });
        const result = await Inbox.updateOne({
          _id: request.inboxId, workspaceId: request.workspaceId,
          tokenHash: { $exists: false }, encryptedToken: { $exists: false },
        }, { $set: credential }, { runValidators: true, strict: "throw" });
        if (result.modifiedCount !== 1) throw new ApiError("CONFLICT");
      });
    },
    rotateForOwner(request: OwnerCaptureTokenRequest): Promise<void> {
      return safeStorageOperation(async () => {
        await requireOwner(request);
        const filter = { _id: request.inboxId, workspaceId: request.workspaceId };
        const inbox = await Inbox.findOne(filter).select("+tokenHash +encryptedToken").lean().exec();
        if (!inbox) throw new ApiError("NOT_FOUND");
        // Legacy metadata-only records need explicit provisioning, not implicit rotation.
        if (!inbox.tokenHash || !inbox.encryptedToken) throw new ApiError("CONFLICT");
        const credential = crypto.issue({ workspaceId: request.workspaceId.toHexString(), inboxId: request.inboxId.toHexString() });
        if (credential.tokenHash === inbox.tokenHash) throw new ApiError("CONFLICT");
        // One atomic pair replacement. A concurrent rotation of this generation wins once.
        const result = await Inbox.updateOne({ ...filter, tokenHash: inbox.tokenHash }, { $set: credential }, {
          runValidators: true, strict: "throw",
        });
        if (result.modifiedCount !== 1) throw new ApiError("CONFLICT");
      });
    },
    findByCaptureToken(token: unknown) {
      return safeStorageOperation(async () => {
        const tokenHash = hashCaptureToken(token);
        if (!tokenHash) return null;
        const inbox = await Inbox.findOne({ tokenHash }).select("_id workspaceId enabled retentionDays").lean().exec();
        if (!inbox || !await Workspace.exists({ _id: inbox.workspaceId, state: "active" })) return null;
        // Disabled remains observable to the later capture route for its 410 response.
        return { inboxId: inbox._id, workspaceId: inbox.workspaceId, enabled: inbox.enabled, retentionDays: inbox.retentionDays };
      });
    },
    retrieveForOwner(request: OwnerCaptureTokenRequest): Promise<string> {
      return safeStorageOperation(async () => {
        await requireOwner(request);
        const inbox = await Inbox.findOne({ _id: request.inboxId, workspaceId: request.workspaceId })
          .select("+tokenHash +encryptedToken").lean().exec();
        if (!inbox || inbox.tokenHash === undefined && inbox.encryptedToken === undefined) throw new ApiError("NOT_FOUND");
        return crypto.decrypt(inbox.encryptedToken, {
          workspaceId: request.workspaceId.toHexString(), inboxId: request.inboxId.toHexString(),
        }, inbox.tokenHash);
      });
    },
  });
}

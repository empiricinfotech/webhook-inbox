import { Types, type Connection } from "mongoose";
import { inboxNameSchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { ApiError } from "../errors.js";
import { getWorkspaceModel } from "../models/workspace.js";
import { isDuplicateKey, safeStorageOperation } from "./storage-operation.js";

export interface LocalWorkspaceRequest {
  ownerId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
}

// Trusted local operator composition only; not user registration or an HTTP handler.
export function bootstrapLocalWorkspace(connection: Connection, request: LocalWorkspaceRequest) {
  return safeStorageOperation(async () => {
    const name = inboxNameSchema.safeParse(request?.name);
    if (!(request?.ownerId instanceof Types.ObjectId) || !(request?.workspaceId instanceof Types.ObjectId) || !name.success) {
      throw new ApiError("INVALID_REQUEST");
    }
    const Workspace = getWorkspaceModel(connection);
    await Workspace.createIndexes();
    // The configured _id is the idempotency boundary. Never overwrite an existing owner/name/state.
    try { await Workspace.create({ _id: request.workspaceId, ownerId: request.ownerId, name: name.data }); }
    catch (error) { if (!isDuplicateKey(error)) throw error; }
    const workspace = await Workspace.findById(request.workspaceId).lean().exec();
    if (!workspace || !workspace.ownerId.equals(request.ownerId) || workspace.state !== "active") {
      throw new ApiError("CONFLICT");
    }
    return { id: workspace._id.toHexString(), name: workspace.name, state: workspace.state,
      createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() };
  });
}

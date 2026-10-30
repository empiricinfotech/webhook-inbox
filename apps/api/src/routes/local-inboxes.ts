import express, { type RequestHandler } from "express";
import { Types, type Connection } from "mongoose";
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { ApiError } from "../errors.js";
import { getWorkspaceModel } from "../models/workspace.js";
import { createInboxService } from "../services/inboxes.js";
import { safeStorageOperation } from "../services/storage-operation.js";
import type { CaptureTokenCrypto } from "../security/capture-token.js";

export interface LocalInboxAccess {
  actorId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  webOrigin: string;
  apiHost: string;
}
export async function createLocalInboxRouter(connection: Connection, crypto: CaptureTokenCrypto, access: LocalInboxAccess) {
  const service = await createInboxService(connection, crypto);
  const Workspace = getWorkspaceModel(connection);
  const request = { actorId: access.actorId, workspaceId: access.workspaceId };
  const router = express.Router();
  // Explicit local mode only. No CORS; refuse rebinding hosts and cross-site browser access.
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("Origin");
    if (![access.apiHost, new URL(access.webOrigin).host].includes(req.get("Host") ?? "")
      || req.get("Sec-Fetch-Site") === "cross-site" || origin !== undefined && origin !== access.webOrigin
      || req.method === "POST" && origin !== access.webOrigin) {
      next(new ApiError("FORBIDDEN")); return;
    }
    next();
  });
  router.get("/local-workspace", async (_req, res) => {
    const data = await safeStorageOperation(async () => {
      const workspace = await Workspace.findOne({ _id: request.workspaceId, ownerId: request.actorId, state: "active" })
        .select("_id name").lean().exec();
      if (!workspace) throw new ApiError("NOT_FOUND");
      return { id: workspace._id.toHexString(), name: workspace.name };
    });
    res.json({ data });
  });
  const scope: RequestHandler = (req, _res, next) => {
    const id = identifierSchema.safeParse(req.params.workspaceId);
    if (!id.success) { next(new ApiError("INVALID_REQUEST")); return; }
    if (id.data !== access.workspaceId.toHexString()) { next(new ApiError("NOT_FOUND")); return; }
    next();
  };
  router.get("/workspaces/:workspaceId/inboxes", scope, async (req, res) => {
    res.json(await service.pageForOwner(request, req.query));
  });
  router.post("/workspaces/:workspaceId/inboxes", scope,
    express.json({ limit: "4kb", strict: true, inflate: false }), async (req, res) => {
      if (!req.is("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
      const data = await service.createForOwner(request, req.body);
      res.status(201).location(`/api/v1/inboxes/${data.id}`).json({ data });
    });
  router.get("/inboxes/:id", async (req, res) => {
    const id = identifierSchema.safeParse(req.params.id);
    if (!id.success) throw new ApiError("INVALID_REQUEST");
    res.json({ data: await service.getForOwner(request, new Types.ObjectId(id.data)) });
  });
  // Body-parser errors contain private body data: replace before the shared error handler.
  router.use(((error, _req, _res, next) => {
    next(error instanceof ApiError ? error :
      typeof error === "object" && error !== null && "type" in error
        ? new ApiError(error.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE"
          : error.type === "encoding.unsupported" || error.type === "charset.unsupported" ? "UNSUPPORTED_MEDIA_TYPE" : "INVALID_REQUEST") : error);
  }) as express.ErrorRequestHandler);
  return router;
}

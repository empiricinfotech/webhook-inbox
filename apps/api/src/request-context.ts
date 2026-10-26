import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { REQUEST_ID_HEADER, type RequestId } from "@empiric-webhook-inbox/contracts/identifiers";

export type RequestLogger = Pick<Logger, "info" | "error">;
const context = new AsyncLocalStorage<Readonly<{ requestId: RequestId }>>();

export function getRequestId(): RequestId {
  const store = context.getStore();
  if (!store) throw new Error("Request context is unavailable");
  return store.requestId;
}

export function requestContext(logger?: RequestLogger): RequestHandler {
  return (request, response, next) => {
    // Inbound IDs are untrusted, even when syntactically valid; never reuse/log them.
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.once("finish", () => {
      // Log allowlisted fields only. originalUrl, params, query and headers can contain secrets.
      logger?.info({
        requestId,
        method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)
          ? request.method : "OTHER",
        route: typeof request.route?.path === "string" ? request.route.path : "unmatched",
        status: response.statusCode,
        durationMs: Math.max(0, performance.now() - started),
      }, "Request completed");
    });
    context.run(Object.freeze({ requestId }), next);
  };
}

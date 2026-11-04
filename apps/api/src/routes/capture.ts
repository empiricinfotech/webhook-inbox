import express, { type Response } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { ApiError } from "../errors.js";
import { CAPTURE_BODY_TIMEOUT_MS, collectCaptureBody, declaredCaptureLength } from "../capture/raw-body.js";
import type { createCaptureTokenService } from "../services/capture-tokens.js";

export const CAPTURE_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export const CAPTURE_ALLOW = [...CAPTURE_METHODS, "OPTIONS"].join(", ");
export type CaptureMethod = typeof CAPTURE_METHODS[number];
type Tokens = Pick<ReturnType<typeof createCaptureTokenService>, "requireEnabledForCapture">;
export interface RawCaptureInput {
  method: CaptureMethod;
  receivedAt: Date;
  inbox: Awaited<ReturnType<Tokens["requireEnabledForCapture"]>>;
  headers: Readonly<IncomingHttpHeaders>;
  rawBody: Buffer;
  receivedBytes: number;
}
export interface CaptureRouterOptions {
  tokens: Tokens;
  handle(input: RawCaptureInput, response: Response): Promise<void>;
  bodyTimeoutMs?: number;
}

// Deliberately requires a downstream handler. No default acknowledgement or raw-data store.
export function createCaptureRouter(options: CaptureRouterOptions) {
  if (typeof options?.handle !== "function" || typeof options.tokens?.requireEnabledForCapture !== "function") {
    throw new TypeError("Capture composition requires a handler and token service");
  }
  const deadline = options.bodyTimeoutMs ?? CAPTURE_BODY_TIMEOUT_MS;
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 30_000) throw new TypeError("Invalid capture body deadline");
  const router = express.Router({ caseSensitive: true, strict: true });
  router.all("/capture/:token", async (req, res) => {
    const receivedAt = new Date();
    res.set("Cache-Control", "no-store");
    // Cover disconnects during asynchronous eligibility checks as well as body reads.
    const ignoreReadError = () => {};
    req.on("error", ignoreReadError);
    req.once("close", () => req.removeListener("error", ignoreReadError));
    if (req.method === "OPTIONS") {
      // Protocol metadata only: no token lookup, body retention or downstream invocation.
      res.set("Allow", CAPTURE_ALLOW).set("Connection", "close").status(204).end();
      return;
    }
    if (!(CAPTURE_METHODS as readonly string[]).includes(req.method)) {
      res.set("Allow", CAPTURE_ALLOW);
      throw new ApiError("METHOD_NOT_ALLOWED");
    }
    declaredCaptureLength(req);
    const inbox = await options.tokens.requireEnabledForCapture(req.params.token);
    const method = req.method as CaptureMethod;
    // Synchronous preflight rejects excessive Content-Length before permitting 100-continue.
    const pending = collectCaptureBody(req, method !== "GET" && method !== "HEAD", deadline);
    if (req.headers.expect?.toLowerCase() === "100-continue") res.writeContinue();
    const body = await pending;
    await options.handle({ method, receivedAt, inbox, headers: { ...req.headers }, rawBody: body.bytes, receivedBytes: body.receivedBytes }, res);
    if (!res.writableEnded) throw new ApiError("INTERNAL_ERROR");
  });
  router.use(((error, _req, res, next) => {
    // Do not drain an untrusted rejected upload or keep its connection reusable.
    if (!res.headersSent) res.set("Connection", "close");
    next(error instanceof URIError ? new ApiError("INVALID_REQUEST") : error);
  }) as express.ErrorRequestHandler);
  return router;
}

import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { API_ERRORS, createErrorResponse } from "@empiric-webhook-inbox/contracts/errors";
import { CAPTURE_ALLOW } from "./routes/capture.js";
import { createServer, type Server } from "node:http";
import { createApp, type ReadinessProbe } from "./app.js";
import type { RequestLogger } from "./request-context.js";
import type { ApiEnvironment } from "./config/environment.js";

// Node routes CONNECT outside Express and auto-sends 100-continue unless explicitly handled.
export function createApiServer(isDatabaseReady: ReadinessProbe, logger?: RequestLogger, management?: Router, capture?: Router) {
  const app = createApp(isDatabaseReady, logger, management, capture);
  const server = createServer(app);
  server.on("checkContinue", (request, response) => {
    if (!capture || !request.url?.startsWith("/capture/")) response.writeContinue();
    app(request, response);
  });
  server.on("connect", (_request, socket) => {
    const started = performance.now();
    const requestId = randomUUID();
    const body = JSON.stringify(createErrorResponse("METHOD_NOT_ALLOWED", requestId));
    socket.on("error", () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), 1000);
    deadline.unref();
    socket.once("close", () => clearTimeout(deadline));
    socket.end([
      `HTTP/1.1 ${API_ERRORS.METHOD_NOT_ALLOWED.status} Method Not Allowed`,
      "Connection: close", "Cache-Control: no-store", "Content-Type: application/json; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`, `X-Request-Id: ${requestId}`, `Allow: ${CAPTURE_ALLOW}`, "", body,
    ].join("\r\n"));
    logger?.info({ requestId, method: "OTHER", route: "unmatched", status: 405,
      durationMs: Math.max(0, performance.now() - started) }, "Request completed");
  });
  return server;
}

export function startServer(
  environment: ApiEnvironment,
  isDatabaseReady: ReadinessProbe,
  logger?: RequestLogger,
  management?: Router,
  capture?: Router,
): Promise<Server> {
  const server = createApiServer(isDatabaseReady, logger, management, capture);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(environment.API_PORT, environment.API_HOST, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

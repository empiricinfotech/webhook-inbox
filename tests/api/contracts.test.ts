import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "vitest";
import express from "express";
import pino from "pino";
import { identifierSchema, requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { API_ERRORS, apiErrorCodeSchema, apiErrorResponseSchema, createErrorResponse } from "@empiric-webhook-inbox/contracts/errors";
import { createApp } from "../../apps/api/src/app.js";
import { ApiError, errorHandler } from "../../apps/api/src/errors.js";
import { getRequestId, requestContext } from "../../apps/api/src/request-context.js";

const incomingId = "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5";

async function serve(context: TestContext, app: ReturnType<typeof express>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); } });
  return { logger: pino({}, stream), text: () => lines.join(""),
    records: () => lines.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

test("real application health/404/HEAD responses have fresh IDs and safe correlated logs", async (context) => {
  const logs = logCapture();
  const app = createApp(async () => {
    const before = getRequestId();
    await delay(1);
    assert.equal(getRequestId(), before);
    return true;
  }, logs.logger);
  const base = await serve(context, app);
  const paths = ["/health/live", "/health/ready", "/api/v1/inboxes?secret=synthetic-query-secret",
    "/capture/synthetic-capture-secret", "/synthetic-path-secret"];
  const ids = new Set<string>();
  for (const path of paths) {
    const response = await fetch(base + path, { headers: {
      "X-Request-Id": "synthetic-inbound-secret", Cookie: "synthetic-cookie-secret",
      Authorization: "Bearer synthetic-bearer-secret",
    } });
    const requestId = requestIdSchema.parse(response.headers.get("x-request-id"));
    ids.add(requestId);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    if (path.startsWith("/health/")) {
      assert.equal(response.status, 200);
      assert.deepEqual(body, { data: { status: path.endsWith("live") ? "live" : "ready" } });
    } else {
      assert.equal(response.status, 404);
      assert.deepEqual(apiErrorResponseSchema.parse(body), createErrorResponse("NOT_FOUND", requestId));
    }
  }
  const head = await fetch(base + "/api/v1/missing", { method: "HEAD" });
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
  requestIdSchema.parse(head.headers.get("x-request-id"));
  assert.equal(ids.size, paths.length);
  const records = logs.records();
  assert.equal(records.length, paths.length + 1);
  for (const requestId of ids) assert.equal(records.filter((record) => record.requestId === requestId).length, 1);
  for (const record of records) {
    assert.ok(["/health/live", "/health/ready", "unmatched"].includes(record.route));
    assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0);
  }
  assert.doesNotMatch(logs.text(), /synthetic-|Bearer|Cookie|Authorization|mongodb:/);
  assert.throws(getRequestId, /Request context is unavailable/);
});

test("async context stays isolated across concurrent requests; expected/validation/unexpected errors stay safe", async (context) => {
  const logs = logCapture();
  const app = express();
  app.use(requestContext(logs.logger));
  app.get("/overlap/:id", async (_request, response) => {
    const before = getRequestId();
    await delay(2);
    assert.equal(getRequestId(), before);
    response.json({ data: { requestId: getRequestId() } });
  });
  app.get("/expected/:code", (request) => { throw new ApiError(apiErrorCodeSchema.parse(request.params.code)); });
  app.get("/validate/:id", (request, response) => { response.json(identifierSchema.parse(request.params.id)); });
  app.post("/unexpected/:id", async () => {
    await delay(1);
    throw Object.assign(new Error("synthetic-driver-password", { cause: "synthetic-cause-secret" }), {
      status: 401, headers: { "X-Private": "synthetic-error-header" },
    });
  });
  app.use(errorHandler(logs.logger));
  const base = await serve(context, app);
  const ids = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const response = await fetch(`${base}/overlap/${index}?query=synthetic-query-secret`, {
      headers: { "X-Request-Id": incomingId },
    });
    const requestId = requestIdSchema.parse(response.headers.get("x-request-id"));
    assert.notEqual(requestId, incomingId);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { requestId } });
    return requestId;
  }));
  assert.equal(new Set(ids).size, ids.length);
  for (const code of apiErrorCodeSchema.options) {
    const response = await fetch(`${base}/expected/${code}`);
    assert.equal(response.status, API_ERRORS[code].status);
    assert.deepEqual(await response.json(), createErrorResponse(code,
      requestIdSchema.parse(response.headers.get("x-request-id"))));
  }
  const invalid = await fetch(base + "/validate/synthetic-private-id");
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), createErrorResponse("INVALID_REQUEST",
    requestIdSchema.parse(invalid.headers.get("x-request-id"))));
  const failure = await fetch(base + "/unexpected/synthetic-path-secret", {
    method: "POST", body: "synthetic-body-secret", headers: { Cookie: "synthetic-cookie-secret" },
  });
  assert.equal(failure.status, 500);
  assert.equal(failure.headers.get("x-private"), null);
  const failedId = requestIdSchema.parse(failure.headers.get("x-request-id"));
  assert.deepEqual(await failure.json(), createErrorResponse("INTERNAL_ERROR", failedId));
  const records = logs.records();
  assert.ok(records.some((record) => record.requestId === failedId && record.msg === "Request failed"));
  assert.ok(records.some((record) => record.requestId === failedId && record.status === 500 && record.msg === "Request completed"));
  assert.equal(records.filter((record) => record.msg === "Request completed").length, 20 + apiErrorCodeSchema.options.length + 2);
  assert.doesNotMatch(logs.text(), /synthetic-|Bearer|Cookie|Authorization|mongodb:|stack|cause/);
  assert.throws(getRequestId, /Request context is unavailable/);
});

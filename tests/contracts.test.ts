import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import express, { type Request, type Response } from "express";
import pino from "pino";
import { z } from "zod";
import { identifierSchema, requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { API_ERRORS, apiErrorCodeSchema, apiErrorResponseSchema, createErrorResponse } from "@empiric-webhook-inbox/contracts/errors";
import { MAX_CURSOR_LENGTH, MAX_PAGE_SIZE, pageResponseSchema, paginationQuerySchema } from "@empiric-webhook-inbox/contracts/pagination";
import { createApp } from "../apps/api/src/app.js";
import { ApiError, errorHandler } from "../apps/api/src/errors.js";
import { getRequestId, requestContext } from "../apps/api/src/request-context.js";

const id = "0123456789abcdef01234567";
const incomingId = "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5";

async function serve(context: TestContext, app: ReturnType<typeof express>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
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

test("identifiers accept only 24 hex characters and canonicalize ObjectId strings", () => {
  assert.equal(identifierSchema.parse(id.toUpperCase()), id);
  for (const value of [undefined, null, 12, {}, [id], "", "a".repeat(12), "a".repeat(23),
    "a".repeat(25), "g".repeat(24), ` ${id}`, `${id} `, { $ne: null }]) {
    assert.equal(identifierSchema.safeParse(value).success, false);
  }
  assert.equal(requestIdSchema.parse(incomingId), incomingId);
  for (const value of [id, "synthetic-private-id", "00000000-0000-0000-0000-000000000000"])
    assert.equal(requestIdSchema.safeParse(value).success, false);
});

test("pagination bounds strict query strings and rejects arrays, operators and extra fields", () => {
  assert.deepEqual(paginationQuerySchema.parse({}), { limit: 25 });
  for (const limit of ["1", "25", "100"])
    assert.deepEqual(paginationQuerySchema.parse({ limit, cursor: "synthetic_cursor-1" }),
      { limit: Number(limit), cursor: "synthetic_cursor-1" });
  for (const limit of ["", "0", "101", "999999999999", "1e2", "1.5", "-1", " 25", "025", 25,
    null, true, ["25"], { $gt: 0 }]) {
    assert.equal(paginationQuerySchema.safeParse({ limit }).success, false);
  }
  for (const cursor of ["", "a".repeat(MAX_CURSOR_LENGTH + 1), "a/b", "a=b", "a+b", " ",
    '{"$gt":0}', ["token"], null, { $ne: null }]) {
    assert.equal(paginationQuerySchema.safeParse({ cursor }).success, false);
  }
  assert.equal(paginationQuerySchema.safeParse({ cursor: "a".repeat(MAX_CURSOR_LENGTH) }).success, true);
  assert.equal(paginationQuerySchema.safeParse({ sort: { $where: "synthetic" } }).success, false);
  const page = pageResponseSchema(z.strictObject({ id: identifierSchema }));
  assert.deepEqual(page.parse({ data: [], nextCursor: null }), { data: [], nextCursor: null });
  assert.deepEqual(page.parse({ data: [{ id }], nextCursor: "next_token" }),
    { data: [{ id }], nextCursor: "next_token" });
  for (const value of [{ data: [], nextCursor: undefined }, { data: [], nextCursor: "" },
    { data: [{ id: "invalid" }], nextCursor: null },
    { data: Array.from({ length: MAX_PAGE_SIZE + 1 }, () => ({ id })), nextCursor: null },
    { data: [], nextCursor: null, query: {} }]) assert.equal(page.safeParse(value).success, false);
});

test("error envelopes require a known code, bounded message and valid request ID without private fields", () => {
  for (const code of apiErrorCodeSchema.options) {
    const response = createErrorResponse(code, incomingId);
    assert.deepEqual(apiErrorResponseSchema.parse(response), response);
    assert.equal(response.error.message, API_ERRORS[code].message);
  }
  const valid = createErrorResponse("NOT_FOUND", incomingId);
  for (const value of [
    { ...valid, stack: "synthetic-private-stack" },
    { error: { ...valid.error, input: "synthetic-private-input" } },
    { error: { ...valid.error, code: "UNKNOWN" } },
    { error: { ...valid.error, requestId: "invalid" } },
    { error: { ...valid.error, message: "" } },
    { error: { ...valid.error, message: "a".repeat(201) } },
  ]) assert.equal(apiErrorResponseSchema.safeParse(value).success, false);
});

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

test("errors after headers are sent delegate termination with a sanitized error", () => {
  const original = new Error("synthetic-private-error");
  let delegated = false;
  errorHandler()(original, {} as Request, { headersSent: true } as Response, (error: unknown) => {
    delegated = true;
    assert.ok(error instanceof Error);
    assert.notEqual(error, original);
    assert.equal(error.message, "Request failed after response started");
    assert.doesNotMatch(error.stack || "", /synthetic-private-error/);
  });
  assert.equal(delegated, true);
});

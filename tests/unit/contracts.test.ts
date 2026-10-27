import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import type { Request, Response } from "express";
import { identifierSchema, requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { API_ERRORS, apiErrorCodeSchema, apiErrorResponseSchema, createErrorResponse } from "@empiric-webhook-inbox/contracts/errors";
import { MAX_CURSOR_LENGTH, MAX_PAGE_SIZE, pageResponseSchema, paginationQuerySchema } from "@empiric-webhook-inbox/contracts/pagination";
import { errorHandler } from "../../apps/api/src/errors.js";

const id = "0123456789abcdef01234567";
const incomingId = "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5";

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

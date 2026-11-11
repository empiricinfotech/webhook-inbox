import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { Writable } from "node:stream";
import { Types } from "mongoose";
import pino from "pino";
import { expect, vi } from "vitest";
import { apiErrorResponseSchema, createErrorResponse, type ApiErrorCode } from "@empiric-webhook-inbox/contracts/errors";
import { inboxSummarySchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { test } from "../helpers/api-fixture.js";
import { prepareCapture, MAX_FORM_FIELDS, MAX_JSON_DEPTH, type PreparedCapture } from "../../apps/api/src/capture/prepare.js";
import { createCaptureSanitizer, type SanitizedCapture } from "../../apps/api/src/capture/sanitize.js";
import { MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import { createApiServer } from "../../apps/api/src/server.js";
import { createCaptureRouter, CAPTURE_ALLOW, CAPTURE_METHODS, type RawCaptureInput } from "../../apps/api/src/routes/capture.js";
import { createLocalInboxRouter } from "../../apps/api/src/routes/local-inboxes.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";
import { createInboxService } from "../../apps/api/src/services/inboxes.js";
import { bootstrapLocalWorkspace } from "../../apps/api/src/services/local-workspace.js";

interface Reply { status: number; headers: IncomingHttpHeaders; text: string; continues: number }
const captureTest = test.extend("capture", async ({ mongo }, { onCleanup }) => {
  const owner = { actorId: new Types.ObjectId(), workspaceId: new Types.ObjectId() };
  await bootstrapLocalWorkspace(mongo.connection, { ownerId: owner.actorId, workspaceId: owner.workspaceId, name: "Synthetic capture workspace" });
  const crypto = createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) });
  const inboxes = await createInboxService(mongo.connection, crypto);
  const inbox = await inboxes.createForOwner(owner, { name: "Synthetic capture transport" });
  const request = { ...owner, inboxId: new Types.ObjectId(inbox.id) };
  const tokens = createCaptureTokenService(mongo.connection, crypto);
  const token = await tokens.retrieveForOwner(request);
  const resolve = vi.fn(tokens.requireEnabledForCapture);
  const received: RawCaptureInput[] = [];
  // Test probe only; a production consumer must implement later sanitization/durable storage.
  const handle = vi.fn(async (input: RawCaptureInput, response: import("express").Response) => {
    received.push(input); response.status(204).end();
  });
  const lines: string[] = [];
  const logger = pino({}, new Writable({ write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); } }));
  const router = createCaptureRouter({ tokens: { requireEnabledForCapture: resolve }, handle, bodyTimeoutMs: 1000 });
  const management = await createLocalInboxRouter(mongo.connection, crypto, { ...owner, webOrigin: "http://127.0.0.1:3000", apiHost: "127.0.0.1:4000" });
  const server = createApiServer(() => Promise.resolve(true), logger, management, router);
  onCleanup(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected owned HTTP listener");
  const exchange = (path: string, method = "POST", chunks: Buffer[] = [], headers: Record<string, string | undefined> = {}, mode: "normal" | "continue" | "stall" = "normal") => new Promise<Reply>((done, reject) => {
    let continues = 0;
    const outgoingHeaders = Object.fromEntries(Object.entries({ "Content-Type": "text/plain", ...headers }).filter(([, value]) => value !== undefined));
    const client = httpRequest({ host: "127.0.0.1", port: address.port, path, method, headers: outgoingHeaders }, (response) => {
      const parts: Buffer[] = [];
      response.on("error", reject);
      response.on("data", (part: Buffer) => parts.push(part));
      response.on("end", () => {
        done({ status: response.statusCode!, headers: response.headers, text: Buffer.concat(parts).toString("utf8"), continues });
        client.destroy();
      });
    });
    client.setTimeout(4000, () => client.destroy(new Error("Owned capture request timed out")));
    client.on("error", reject);
    client.on("continue", () => { continues++; if (mode === "continue") { for (const chunk of chunks) client.write(chunk); client.end(); } });
    if (mode === "continue") client.flushHeaders();
    else { for (const chunk of chunks) client.write(chunk); if (mode === "normal") client.end(); }
  });
  return { owner, inbox, inboxes, tokens, token, request, resolve, received, handle, logs: () => lines.join(""), server,
    port: address.port, path: `/capture/${token}`, exchange };
});
function error(response: Reply, status: number, code: ApiErrorCode) {
  expect(response.status).toBe(status);
  const body = apiErrorResponseSchema.parse(JSON.parse(response.text));
  expect(body).toEqual(createErrorResponse(code, body.error.requestId));
  expect(response.headers["x-request-id"]).toBe(body.error.requestId);
  expect(response.headers["cache-control"]).toBe("no-store");
}
async function rawHttp(port: number, message: string) {
  return new Promise<Reply>((done, reject) => {
    const parts: Buffer[] = [];
    const client = connect(port, "127.0.0.1", () => client.write(message));
    client.setTimeout(3000, () => client.destroy(new Error("Owned raw HTTP probe timed out")));
    client.on("error", reject);
    client.on("data", (part: Buffer) => parts.push(part));
    client.on("end", () => {
      const response = Buffer.concat(parts).toString("utf8");
      const [head, text = ""] = response.split("\r\n\r\n");
      const headers: IncomingHttpHeaders = {};
      for (const line of head!.split("\r\n").slice(1)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
      }
      done({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]), text, headers, continues: 0 });
      client.destroy();
    });
  });
}

function tunnel(port: number, path: string) {
  return rawHttp(port, `CONNECT ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
}

captureTest("six explicit methods preserve original bytes; GET/HEAD deliver metadata with an empty body", async ({ capture, mongo }) => {
  const bytes = Buffer.from("😀\r\né synthetic");
  for (const method of CAPTURE_METHODS) {
    const response = await capture.exchange(capture.path, method, [bytes.subarray(0, 2), bytes.subarray(2)], { "Content-Length": String(bytes.length) });
    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    const input = capture.received.at(-1)!;
    expect(input.method).toBe(method);
    expect(input.receivedBytes).toBe(bytes.length);
    expect(input.rawBody.equals(method === "GET" || method === "HEAD" ? Buffer.alloc(0) : bytes)).toBe(true);
    expect(input.inbox.inboxId.toHexString()).toBe(capture.inbox.id);
  }
  expect(capture.received.length).toBe(6);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});

captureTest("OPTIONS is event-free; TRACE and Node CONNECT reject without lookup or body handling", async ({ capture }) => {
  const options = await capture.exchange("/capture/malformed", "OPTIONS");
  expect(options.status).toBe(204); expect(options.headers.allow).toBe(CAPTURE_ALLOW);
  expect(options.headers["access-control-allow-origin"]).toBeUndefined();
  const trace = await capture.exchange(capture.path, "TRACE");
  error(trace, 405, "METHOD_NOT_ALLOWED"); expect(trace.headers.allow).toBe(CAPTURE_ALLOW);
  const connectReply = await tunnel(capture.port, capture.path);
  error(connectReply, 405, "METHOD_NOT_ALLOWED");
  expect(connectReply.headers.allow).toBe(CAPTURE_ALLOW);
  expect(capture.resolve.mock.calls.length).toBe(0); expect(capture.received.length).toBe(0);
  expect(capture.logs().includes(capture.token)).toBe(false);
});

captureTest("declared/chunked exact limits pass and every one-byte overflow rejects before downstream delivery", async ({ capture }) => {
  const bytes = Buffer.alloc(MAX_CAPTURE_BYTES, 97);
  expect((await capture.exchange(capture.path, "POST", [bytes], { "Content-Length": String(bytes.length) })).status).toBe(204);
  expect((await capture.exchange(capture.path, "PATCH", [bytes.subarray(0, 123), bytes.subarray(123)], { "Transfer-Encoding": "chunked" })).status).toBe(204);
  const before = capture.resolve.mock.calls.length;
  const declared = await capture.exchange(capture.path, "POST", [], { "Content-Length": String(MAX_CAPTURE_BYTES + 1), Expect: "100-continue" }, "continue");
  error(declared, 413, "PAYLOAD_TOO_LARGE"); expect(declared.continues).toBe(0);
  expect(capture.resolve.mock.calls.length).toBe(before);
  error(await capture.exchange(capture.path, "PUT", [bytes, Buffer.from([1])], { "Transfer-Encoding": "chunked" }), 413, "PAYLOAD_TOO_LARGE");
  const head = await capture.exchange(capture.path, "HEAD", [], { "Content-Length": String(MAX_CAPTURE_BYTES + 1) });
  expect(head.status).toBe(413); expect(head.text).toBe("");
  expect(capture.received.length).toBe(2);
});

captureTest("token/disabled/storage errors stay correlated and private, without reading into a consumer", async ({ capture, mongo }) => {
  const marker = "synthetic-private-body";
  const headers = { Authorization: "synthetic-private-header", "Content-Length": String(Buffer.byteLength(marker)) };
  const send = (token: string) => capture.exchange(`/capture/${token}?secret=synthetic-private-query`, "POST", [Buffer.from(marker)], headers);
  error(await send(randomBytes(32).toString("base64url")), 404, "NOT_FOUND");
  await capture.inboxes.disableForOwner(capture.owner, capture.request.inboxId);
  error(await send(capture.token), 410, "ENDPOINT_DISABLED");
  await capture.tokens.rotateForOwner(capture.request);
  error(await send(capture.token), 404, "NOT_FOUND");
  const token = await capture.tokens.retrieveForOwner(capture.request);
  error(await send(token), 410, "ENDPOINT_DISABLED");
  await mongo.connection.close();
  error(await send(token), 503, "STORAGE_UNAVAILABLE");
  error(await send("malformed"), 404, "NOT_FOUND");
  expect(capture.received.length).toBe(0);
  expect([capture.token, token, marker, "synthetic-private-header", "synthetic-private-query"].some((value) => capture.logs().includes(value))).toBe(false);
});

captureTest("stalled and aborted uploads never invoke the consumer and a later request recovers", async ({ capture }) => {
  const stalled = await capture.exchange(capture.path, "POST", [Buffer.from("partial")], { "Transfer-Encoding": "chunked" }, "stall");
  error(stalled, 408, "REQUEST_TIMEOUT");
  await new Promise<void>((done, reject) => {
    const client = connect(capture.port, "127.0.0.1", () => {
      client.write(`POST ${capture.path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\npartial`, () => client.destroy());
    });
    client.on("error", reject); client.on("close", () => done());
  });
  expect(capture.received.length).toBe(0);
  expect((await capture.exchange(capture.path, "POST", [Buffer.from("synthetic")], { "Transfer-Encoding": "chunked" })).status).toBe(204);
  expect(capture.received.length).toBe(1);
});

captureTest("route matching stays local and downstream failures never turn into acknowledgements or private errors", async ({ capture }) => {
  error(await capture.exchange("/api/v1/not-capture", "POST"), 403, "FORBIDDEN");
  for (const path of [`/captureevil/${capture.token}`, `${capture.path}/`, `/CAPTURE/${capture.token}`]) {
    error(await capture.exchange(path, "POST"), 404, "NOT_FOUND");
  }
  error(await capture.exchange("/capture/%zz", "POST"), 400, "INVALID_REQUEST");
  capture.handle.mockImplementationOnce(async () => { throw new Error("synthetic-private-consumer-message"); });
  const failed = await capture.exchange(capture.path);
  error(failed, 500, "INTERNAL_ERROR"); expect(failed.text.includes("synthetic-private-consumer-message")).toBe(false);
  capture.handle.mockImplementationOnce(async () => {});
  error(await capture.exchange(capture.path), 500, "INTERNAL_ERROR");
  expect(capture.logs().includes("synthetic-private-consumer-message")).toBe(false);
});

captureTest("100-continue is sent only after capture eligibility/size checks and normal management behavior is preserved", async ({ capture }) => {
  const response = await capture.exchange(capture.path, "POST", [Buffer.from("synthetic")], { Expect: "100-continue", "Content-Length": "9" }, "continue");
  expect(response.status).toBe(204); expect(response.continues).toBe(1);
  const invalid = await capture.exchange("/capture/malformed", "POST", [], { Expect: "100-continue", "Content-Length": "1" }, "continue");
  error(invalid, 404, "NOT_FOUND"); expect(invalid.continues).toBe(0);
  const body = Buffer.from(JSON.stringify({ name: "Synthetic management continue" }));
  const ordinary = await capture.exchange(`/api/v1/workspaces/${capture.owner.workspaceId.toHexString()}/inboxes`, "POST", [body], {
    Host: "127.0.0.1:4000", Origin: "http://127.0.0.1:3000", "Content-Type": "application/json", "Content-Length": String(body.length), Expect: "100-continue",
  }, "continue");
  expect(ordinary.status).toBe(201); expect(ordinary.continues).toBe(1);
  expect(inboxSummarySchema.parse(JSON.parse(ordinary.text).data).name).toBe("Synthetic management continue");
});


captureTest("D06.2 prepares JSON, text and form from real original-byte HTTP transport with private metadata", async ({ capture, mongo }) => {
  const observed: PreparedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => {
    const before = Buffer.from(input.rawBody); observed.push(prepareCapture(input));
    expect(input.rawBody.equals(before)).toBe(true); response.status(204).end();
  });
  const start = Date.now();
  for (const [type, text, format] of [["Application/JSON; Charset=UTF-8", '{"emoji":"😀"}', "json"],
    ["text/html", "<script>globalThis.syntheticCaptureExecuted=true</script>", "text"],
    ["application/x-www-form-urlencoded", "a=1&a=2&x=%F0%9F%98%80", "form"]]) {
    const bytes = Buffer.from(text!);
    const response = await capture.exchange(capture.path + "?private=synthetic-private-query", "POST", [bytes.subarray(0, 2), bytes.subarray(2)], {
      "Content-Type": type!, "Content-Length": String(bytes.length), Authorization: "synthetic-private-header", Cookie: "synthetic-private-cookie", Date: "synthetic-private-time",
    });
    expect(response.status).toBe(204); expect(response.text).toBe("");
    const result = observed.at(-1)!; expect(result.body.format).toBe(format);
    expect(result.metadata.receivedBytes).toBe(bytes.length);
    expect(Date.parse(result.metadata.receivedAt)).toBeGreaterThanOrEqual(start);
    expect(Date.parse(result.metadata.receivedAt)).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(result.metadata).includes("synthetic-private")).toBe(false);
  }
  expect(Object.hasOwn(globalThis, "syntheticCaptureExecuted")).toBe(false);
  expect([capture.token, "synthetic-private-query", "synthetic-private-header", "synthetic-private-cookie", "syntheticCaptureExecuted"].some(value => capture.logs().includes(value))).toBe(false);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});

captureTest("D06.2 respects metadata-only methods, OPTIONS and existing eligibility before preparation", async ({ capture }) => {
  const observed: PreparedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => { observed.push(prepareCapture(input)); response.status(204).end(); });
  for (const method of ["GET", "HEAD"]) {
    expect((await capture.exchange(capture.path, method, [Buffer.from("✓")], { "Content-Type": "application/json", "Content-Length": "3" })).status).toBe(204);
    expect(observed.at(-1)!.body).toEqual({ format: "metadata", parseFailed: false, value: null });
    expect(observed.at(-1)!.metadata.receivedBytes).toBe(3);
  }
  expect((await capture.exchange(capture.path, "OPTIONS")).status).toBe(204);
  await capture.inboxes.disableForOwner(capture.owner, capture.request.inboxId);
  error(await capture.exchange(capture.path, "POST"), 410, "ENDPOINT_DISABLED");
  expect(observed.length).toBe(2);
});

captureTest("D06.2 parsing failures are static private results with no partial content, and the next valid body recovers", async ({ capture, mongo }) => {
  const observed: PreparedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => { observed.push(prepareCapture(input)); response.status(204).end(); });
  for (const [type, bytes, extra, reason] of [
    ["application/json", Buffer.from('{"synthetic-private-body":'), {}, "invalid_json"],
    ["application/x-www-form-urlencoded", Buffer.from("synthetic-private-body=%FF"), {}, "invalid_form"],
  ] as const) {
    const response = await capture.exchange(capture.path, "POST", [bytes], { "Content-Type": type, "Content-Length": String(bytes.length), ...extra });
    expect(response.status).toBe(204); // A test-only probe, never a capture acknowledgement.
    expect(observed.at(-1)!.body).toEqual({ format: "unparsed", parseFailed: true, value: null, reason });
    expect(JSON.stringify(observed.at(-1)).includes("synthetic-private-body")).toBe(false);
  }
  expect((await capture.exchange(capture.path, "POST", [Buffer.from("{}")], { "Content-Type": "application/json", "Content-Length": "2" })).status).toBe(204);
  expect(observed.at(-1)!.body.parseFailed).toBe(false);
  expect(capture.logs().includes("synthetic-private-body")).toBe(false);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});

captureTest("D06.2 enforces parser complexity bounds after transport and never prepares oversized uploads", async ({ capture }) => {
  const observed: PreparedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => { observed.push(prepareCapture(input)); response.status(204).end(); });
  const send = (text: string, type: string) => capture.exchange(capture.path, "POST", [Buffer.from(text)], { "Content-Type": type, "Content-Length": String(Buffer.byteLength(text)) });
  expect((await send("[".repeat(MAX_JSON_DEPTH + 1) + "0" + "]".repeat(MAX_JSON_DEPTH + 1), "application/json")).status).toBe(204);
  expect(observed.at(-1)!.body.parseFailed && observed.at(-1)!.body.format === "unparsed").toBe(true);
  expect((await send(Array(MAX_FORM_FIELDS + 1).fill("a=1").join("&"), "application/x-www-form-urlencoded")).status).toBe(204);
  expect(observed.at(-1)!.body.parseFailed).toBe(true);
  expect((await send("a".repeat(MAX_CAPTURE_BYTES), "text/plain")).status).toBe(204);
  expect(observed.at(-1)!.body.parseFailed).toBe(false);
  error(await send("a".repeat(MAX_CAPTURE_BYTES + 1), "text/plain"), 413, "PAYLOAD_TOO_LARGE");
  expect(observed.length).toBe(3);
});


captureTest("D06.3 rejects unsupported headers before lookup/100-continue, while proven-empty bodies and method priority stay usable", async ({ capture }) => {
  const invalid: Record<string, string | undefined>[] = [
    { "Content-Type": undefined }, { "Content-Type": "not-a-type" }, { "Content-Type": "application/octet-stream; private=synthetic-private-header" },
    { "Content-Type": "image/png" }, { "Content-Type": "application/pdf" }, { "Content-Type": "multipart/form-data; boundary=synthetic" },
    { "Content-Type": "application/xml" }, { "Content-Type": "text/plain; charset=iso-8859-1" }, { "Content-Type": "text/plain; charset=utf-16" },
    { "Content-Type": "text/" + "a".repeat(513) }, ...["gzip", "deflate", "br", "identity, gzip", "", "unknown"].map(value => ({ "Content-Encoding": value })),
  ];
  for (const headers of invalid) {
    const reply = await capture.exchange(capture.path + "?private=synthetic-private-query", "POST", [], { "Content-Length": "1", Expect: "100-continue", ...headers }, "continue");
    error(reply, 415, "UNSUPPORTED_MEDIA_TYPE"); expect(reply.continues).toBe(0);
    expect(reply.headers.connection).toBe("close"); expect(reply.headers["accept-encoding"]).toBe("identity");
  }
  error(await capture.exchange(capture.path, "POST", [], { "Content-Length": String(MAX_CAPTURE_BYTES + 1), "Content-Encoding": "gzip" }), 413, "PAYLOAD_TOO_LARGE");
  const options = await capture.exchange(capture.path, "OPTIONS", [], { "Content-Length": String(MAX_CAPTURE_BYTES + 1), "Content-Encoding": "gzip", Expect: "100-continue" }, "continue");
  expect(options.status).toBe(204); expect(options.continues).toBe(0);
  error(await capture.exchange(capture.path, "TRACE", [], { "Content-Encoding": "gzip" }), 405, "METHOD_NOT_ALLOWED");
  expect(capture.resolve.mock.calls.length).toBe(0); expect(capture.received.length).toBe(0);
  for (const method of ["POST", "GET", "HEAD"]) {
    expect((await capture.exchange(capture.path, method, [], { "Content-Type": undefined, "Content-Length": "0" })).status).toBe(204);
  }
  error(await capture.exchange(capture.path, "POST", [], { "Content-Type": undefined, "Transfer-Encoding": "chunked", Expect: "100-continue" }, "continue"), 415, "UNSUPPORTED_MEDIA_TYPE");
  expect([capture.token, "synthetic-private-header", "synthetic-private-query"].some(value => capture.logs().includes(value))).toBe(false);
});

captureTest("D06.3 rejects actual compression and binary/invalid UTF-8 on all six methods without downstream delivery, then recovers", async ({ capture, mongo }) => {
  const text = Buffer.from("synthetic-private-body".repeat(100));
  for (const [encoding, bytes] of [["gzip", gzipSync(text)], ["deflate", deflateSync(text)], ["br", brotliCompressSync(text)]] as const) {
    error(await capture.exchange(capture.path, "POST", [bytes], { "Content-Length": String(bytes.length), "Content-Encoding": encoding }), 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const vectors = [Buffer.from([0]), Buffer.from([255]), Buffer.from([240]), Buffer.from([192, 175]), Buffer.from([237, 160, 128]),
    Buffer.from([194, 133]), Buffer.from([80, 75, 3, 4]), gzipSync(text)];
  for (const method of CAPTURE_METHODS) for (const bytes of vectors) {
    const reply = await capture.exchange(capture.path, method, [bytes], { "Content-Length": String(bytes.length) });
    if (method === "HEAD") {
      expect(reply.status).toBe(415); expect(reply.text).toBe(""); expect(reply.headers["cache-control"]).toBe("no-store");
      expect(requestIdSchema.safeParse(reply.headers["x-request-id"]).success).toBe(true);
    } else error(reply, 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  expect(capture.received.length).toBe(0); expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
  expect((await capture.exchange(capture.path, "POST", [Buffer.from("synthetic recovery")])).status).toBe(204);
  expect(capture.received.length).toBe(1);
  expect([capture.token, "synthetic-private-body"].some(value => capture.logs().includes(value))).toBe(false);
});

captureTest("D06.3 streamed UTF-8 validates split characters at the exact size bound, rejects overflow/truncated EOF, and retains no partial capture", async ({ capture }) => {
  const bytes = Buffer.from("😀".repeat(MAX_CAPTURE_BYTES / 4));
  const accepted = await capture.exchange(capture.path, "PATCH", [bytes.subarray(0, 1), bytes.subarray(1, 3), bytes.subarray(3)], { "Transfer-Encoding": "chunked" });
  expect(accepted.status).toBe(204); expect(capture.received[0]!.rawBody.equals(bytes)).toBe(true);
  error(await capture.exchange(capture.path, "PUT", [bytes, Buffer.from("a")], { "Transfer-Encoding": "chunked" }), 413, "PAYLOAD_TOO_LARGE");
  error(await capture.exchange(capture.path, "POST", [Buffer.alloc(MAX_CAPTURE_BYTES - 1, 97), Buffer.from([240])], { "Transfer-Encoding": "chunked" }), 415, "UNSUPPORTED_MEDIA_TYPE");
  const continuing = await capture.exchange(capture.path, "POST", [Buffer.from([0])], { "Content-Length": "1", Expect: "100-continue" }, "continue");
  error(continuing, 415, "UNSUPPORTED_MEDIA_TYPE"); expect(continuing.continues).toBe(1);
  expect(capture.received.length).toBe(1);
});

captureTest("D06.3 sees duplicate MIME/encoding fields through Node even when its ordinary header map hides one", async ({ capture }) => {
  for (const fields of [["Content-Type: text/plain", "Content-Type: application/octet-stream"],
    ["Content-Type: application/octet-stream", "Content-Type: text/plain"],
    ["Content-Type: text/plain", "Content-Encoding: identity", "Content-Encoding: identity"]]) {
    const reply = await rawHttp(capture.port, [`POST ${capture.path} HTTP/1.1`, "Host: 127.0.0.1", "Content-Length: 0", ...fields, "", ""].join("\r\n"));
    error(reply, 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  expect(capture.resolve.mock.calls.length).toBe(0); expect(capture.received.length).toBe(0);
});

captureTest("D06.3 accepted JSON suffixes, quoted UTF-8 and identity text/form still compose with preparation without mutating bytes or storing events", async ({ capture, mongo }) => {
  const prepared: PreparedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => {
    const before = Buffer.from(input.rawBody); prepared.push(prepareCapture(input));
    expect(input.rawBody.equals(before)).toBe(true); response.status(204).end();
  });
  for (const [type, text, format] of [['Application/Problem+JSON; Charset="UTF-8"', '{"synthetic":true}', "json"],
    ["application/x-www-form-urlencoded; charset=utf8", "a=1&a=2", "form"], ["text/html", "<script>syntheticDataOnly()</script>\r\n", "text"]] as const) {
    const bytes = Buffer.from(text);
    expect((await capture.exchange(capture.path, "POST", [bytes], { "Content-Type": type, "Content-Length": String(bytes.length), "Content-Encoding": " IDENTITY " })).status).toBe(204);
    expect(prepared.at(-1)!.body.format).toBe(format); expect(prepared.at(-1)!.body.parseFailed).toBe(false);
  }
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});


captureTest("D07.1 composed sanitization omits credentials and nested secrets without changing original transport bytes", async ({ capture, mongo }) => {
  const sanitize = createCaptureSanitizer({ sensitiveJsonKeys: ["private_value"] });
  const observed: SanitizedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => {
    const raw = Buffer.from(input.rawBody), headers = JSON.stringify(input.headers);
    observed.push(sanitize(input));
    expect(input.rawBody.equals(raw) && JSON.stringify(input.headers) === headers).toBe(true);
    response.status(204).end(); // Observation only: no storage/success acknowledgement.
  });
  const bytes = Buffer.from('{"safe":"😀","nested":[{"PASSWORD":"synthetic-private-body","keep":1},{"private_value":{"deep":"synthetic-private-body"}}]}');
  const reply = await capture.exchange(capture.path + "?private=synthetic-private-query", "POST", [bytes.subarray(0, 3), bytes.subarray(3)], {
    "Content-Type": 'Application/JSON; private="synthetic-private-param"', "Content-Length": String(bytes.length),
    Authorization: "synthetic-private-header", Cookie: "synthetic-private-cookie", "Proxy-Authorization": "synthetic-private-proxy",
    "X-Api-Key": "synthetic-private-key", "X-Custom-Credential": "synthetic-private-custom", "X-Hub-Signature-256": "synthetic-private-signature",
  });
  expect(reply.status).toBe(204); expect(reply.text).toBe("");
  expect(observed[0]!.body).toEqual({ format: "json", parseFailed: false, value: { safe: "😀", nested: [{ keep: 1 }, {}] } });
  expect(observed[0]!.metadata.safeHeaders).toEqual({ "content-type": "application/json" });
  expect(observed[0]!.redaction.jsonKeysRemoved).toBe(2);
  expect(JSON.stringify(observed).includes("synthetic-private")).toBe(false);
  expect(capture.logs().includes("synthetic-private") || capture.logs().includes(capture.token)).toBe(false);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});

captureTest("D07.1 per-inbox trusted policies isolate captures and can omit every non-metadata body", async ({ capture, mongo }) => {
  const enabled = createCaptureSanitizer({ sensitiveJsonKeys: ["first"] });
  const disabled = createCaptureSanitizer({ captureBody: false });
  const observed: SanitizedCapture[] = [];
  let sanitize = enabled;
  capture.handle.mockImplementation(async (input, response) => { observed.push(sanitize(input)); response.status(204).end(); });
  const send = (text: string, type: string, method = "POST") => capture.exchange(capture.path, method, [Buffer.from(text)], {
    "Content-Type": type, "Content-Length": String(Buffer.byteLength(text)), "X-Capture-Body": "true",
  });
  expect((await send('{"first":1,"second":2}', "application/json")).status).toBe(204);
  expect(observed.at(-1)!.body.value).toEqual({ second: 2 });
  sanitize = disabled;
  for (const [text, type] of [["secret=synthetic-private", "application/x-www-form-urlencoded"], ["synthetic-private", "text/html"], ['{"secret":"synthetic-private"}', "application/json"]]) {
    expect((await send(text!, type!)).status).toBe(204);
    expect(observed.at(-1)!.body).toEqual({ format: "omitted", parseFailed: false, value: null });
    expect(observed.at(-1)!.redaction.bodyOmitted).toBe(true);
  }
  for (const method of ["GET", "HEAD"]) {
    expect((await send("synthetic-private", "text/plain", method)).status).toBe(204);
    expect(observed.at(-1)!.body.format).toBe("metadata");
  }
  const before = observed.length;
  expect((await capture.exchange(capture.path, "OPTIONS")).status).toBe(204); expect(observed.length).toBe(before);
  sanitize = createCaptureSanitizer({ sensitiveJsonKeys: ["second"] });
  expect((await send('{"first":1,"second":2}', "application/json")).status).toBe(204);
  expect(observed.at(-1)!.body.value).toEqual({ first: 1 });
  expect(JSON.stringify(observed).includes("synthetic-private") || capture.logs().includes("synthetic-private")).toBe(false);
  expect(await mongo.connection.collection("events").countDocuments()).toBe(0);
});

captureTest("D07.1 malformed JSON stays empty/flagged and bad trusted configuration fails safely before recovery", async ({ capture }) => {
  const sanitize = createCaptureSanitizer();
  const observed: SanitizedCapture[] = [];
  capture.handle.mockImplementation(async (input, response) => { observed.push(sanitize(input)); response.status(204).end(); });
  const send = (text: string) => capture.exchange(capture.path, "POST", [Buffer.from(text)], { "Content-Type": "application/json" });
  expect((await send('{"synthetic-private":')).status).toBe(204);
  expect(observed.at(-1)!.body).toEqual({ format: "unparsed", parseFailed: true, value: null, reason: "invalid_json" });
  capture.handle.mockImplementationOnce(async () => { createCaptureSanitizer({ sensitiveJsonKeys: ["synthetic-private".repeat(20)] }); });
  const failed = await send('{}'); error(failed, 500, "INTERNAL_ERROR");
  expect(failed.text.includes("synthetic-private") || capture.logs().includes("synthetic-private")).toBe(false);
  expect((await send('{"password":"synthetic-private","ok":true}')).status).toBe(204);
  expect(observed.at(-1)!.body.value).toEqual({ ok: true });
});

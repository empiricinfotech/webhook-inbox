import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { expect, test, vi } from "vitest";
import { createCaptureMediaValidation, readCaptureContentType, captureFormat } from "../../apps/api/src/capture/media.js";
import { collectCaptureBody, MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import { ApiError } from "../../apps/api/src/errors.js";

function request(headers: Record<string, string> = { "content-type": "text/plain" }) {
  return { headers, headersDistinct: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, [value]])) };
}
function rejected(operation: () => unknown) {
  try { operation(); throw new Error("Expected media rejection"); }
  catch (error) { expect(error instanceof ApiError && error.code === "UNSUPPORTED_MEDIA_TYPE").toBe(true); expect(Object.hasOwn(error as object, "cause")).toBe(false); }
}

test("shared media selection normalizes supported JSON/form/text and accepts exact original split UTF-8", () => {
  for (const [type, format] of [['Application/Problem+JSON; Charset="UTF-8"', "json"], ["application/json", "json"], ["application/x-www-form-urlencoded; charset=utf8", "form"], ["text/html", "text"]]) {
    const req = request({ "content-type": type! });
    expect(captureFormat(readCaptureContentType(req.headers).media)).toBe(format);
    const validate = createCaptureMediaValidation(req, 10); const bytes = Buffer.from("😀é\t\r\n"); const before = Buffer.from(bytes);
    for (const byte of bytes) expect(validate.write(Buffer.from([byte]))).toBe(true);
    expect(validate.end()).toBe(true); expect(bytes.equals(before)).toBe(true);
  }
});

test("unsupported media, charset, malformed/large MIME and nonidentity encodings fail with static 415 errors", () => {
  for (const type of ["application/octet-stream", "image/png", "application/xml", "multipart/form-data; boundary=synthetic", "invalid", "text/" + "a".repeat(513), "text/plain; charset=latin1"]) {
    rejected(() => createCaptureMediaValidation(request({ "content-type": type }), 1));
  }
  for (const encoding of ["gzip", "br", "deflate", "identity, gzip", "", "synthetic-private-encoding"]) {
    rejected(() => createCaptureMediaValidation(request({ "content-type": "text/plain", "content-encoding": encoding }), 1));
  }
});

test("missing type is allowed only when framing proves no body; duplicate singleton media fields reject", () => {
  expect(createCaptureMediaValidation(request({}), undefined).end()).toBe(true);
  expect(createCaptureMediaValidation(request({}), 0).end()).toBe(true);
  rejected(() => createCaptureMediaValidation(request({}), 1));
  rejected(() => createCaptureMediaValidation(request({ "transfer-encoding": "chunked" }), undefined));
  for (const field of ["content-type", "content-encoding"]) {
    const req = request(); req.headersDistinct[field] = [field === "content-type" ? "text/plain" : "identity", "synthetic-private-duplicate"];
    rejected(() => createCaptureMediaValidation(req, 0));
  }
});

test("incremental inspection rejects invalid UTF-8 and disallowed C0/C1 controls without blocking normal whitespace/Unicode", () => {
  for (const bytes of [Buffer.from([0]), Buffer.from([11]), Buffer.from([12]), Buffer.from([127]), Buffer.from([255]), Buffer.from([192, 175]), Buffer.from([237, 160, 128]), Buffer.from([194, 133])]) {
    expect(createCaptureMediaValidation(request(), bytes.length).write(bytes)).toBe(false);
  }
  const validate = createCaptureMediaValidation(request(), 4);
  expect(validate.write(Buffer.from([240]))).toBe(true); expect(validate.end()).toBe(false);
  const valid = createCaptureMediaValidation(request(), 7); expect(valid.write(Buffer.from("\t\r\nα😀"))).toBe(true); expect(valid.end()).toBe(true);
});

async function collectionFailure(bytes: Buffer, retain: boolean, code: string) {
  const socket = new Socket(), input = new IncomingMessage(socket); input.complete = true; input.headers["content-type"] = "text/plain";
  try {
    const promise = collectCaptureBody(input, retain, 1000, createCaptureMediaValidation(input, undefined));
    const checked = promise.then(() => { throw new Error("Expected collection rejection"); }, error => {
      expect(error instanceof ApiError && error.code === code).toBe(true); expect(Object.hasOwn(error as object, "cause")).toBe(false);
    });
    input.push(bytes); input.push(null); await checked;
    expect(input.listenerCount("data")).toBe(0); expect(input.listenerCount("end")).toBe(0);
  } finally { input.destroy(); socket.destroy(); }
}

test("stream rejection cleans active readers for both retained and metadata-discarded bodies", async () => {
  for (const retain of [true, false]) await collectionFailure(Buffer.from([0]), retain, "UNSUPPORTED_MEDIA_TYPE");
});

test("incomplete UTF-8 at EOF rejects before any completed Buffer is delivered, including metadata-only reads", async () => {
  for (const retain of [true, false]) await collectionFailure(Buffer.from([240]), retain, "UNSUPPORTED_MEDIA_TYPE");
});

test("actual byte overflow takes precedence before inspecting the offending chunk", async () => {
  const socket = new Socket(), input = new IncomingMessage(socket); input.complete = true;
  const validation = { write: vi.fn(() => true), end: vi.fn(() => true) };
  try {
    const promise = collectCaptureBody(input, true, 1000, validation);
    const checked = promise.then(() => { throw new Error("Expected limit rejection"); }, error => expect(error instanceof ApiError && error.code === "PAYLOAD_TOO_LARGE").toBe(true));
    input.push(Buffer.alloc(MAX_CAPTURE_BYTES + 1, 97)); input.push(null); await checked;
    expect(validation.write.mock.calls.length).toBe(0); expect(validation.end.mock.calls.length).toBe(0);
  } finally { input.destroy(); socket.destroy(); }
});

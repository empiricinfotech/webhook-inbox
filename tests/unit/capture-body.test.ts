import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { expect, test } from "vitest";
import { collectCaptureBody, MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import { ApiError } from "../../apps/api/src/errors.js";

function request() {
  const socket = new Socket();
  const input = new IncomingMessage(socket);
  input.complete = true;
  return input;
}
async function failure(operation: () => unknown, code: string) {
  try { await operation(); throw new Error("Expected body rejection"); }
  catch (error) {
    expect(error instanceof ApiError && error.code === code).toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
  }
}

test("raw collection preserves split original bytes, bounded counts and removes active listeners", async () => {
  const input = request();
  const bytes = Buffer.from([0, 255, 240, 159, 152, 128, 13, 10, 128]);
  try {
    const result = collectCaptureBody(input, true);
    input.push(bytes.subarray(0, 4)); input.push(bytes.subarray(4)); input.push(null);
    const body = await result;
    expect(body.bytes.equals(bytes)).toBe(true);
    expect(body.receivedBytes).toBe(bytes.length);
    for (const event of ["data", "end", "error"]) expect(input.listenerCount(event)).toBe(0);
  } finally { input.destroy(); input.socket.destroy(); }
});

test("exact byte limit passes while metadata-only collection counts without retaining a body", async () => {
  for (const retain of [true, false]) {
    const input = request();
    try {
      input.headers["content-length"] = String(MAX_CAPTURE_BYTES);
      const result = collectCaptureBody(input, retain);
      input.push(Buffer.alloc(MAX_CAPTURE_BYTES)); input.push(null);
      const body = await result;
      expect(body.receivedBytes).toBe(MAX_CAPTURE_BYTES);
      expect(body.bytes.length).toBe(retain ? MAX_CAPTURE_BYTES : 0);
    } finally { input.destroy(); input.socket.destroy(); }
  }
});

test("declared and streamed overflow reject without partial delivery; malformed/decoded input fails closed", async () => {
  for (const kind of ["declared", "streamed", "length", "decoded"]) {
    const input = request();
    try {
      if (kind === "declared") input.headers["content-length"] = String(MAX_CAPTURE_BYTES + 1);
      if (kind === "length") input.headers["content-length"] = "invalid";
      if (kind === "decoded") input.setEncoding("utf8");
      const code = kind === "declared" || kind === "streamed" ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST";
      const failed = failure(() => collectCaptureBody(input, true), code);
      if (kind === "streamed") { input.push(Buffer.alloc(MAX_CAPTURE_BYTES)); input.push(Buffer.from([1])); }
      await failed;
      expect(input.listenerCount("data")).toBe(0);
    } finally { input.destroy(); input.socket.destroy(); }
  }
});

test("incomplete streams, read errors and body deadlines reject safely and release buffered data/listeners", async () => {
  for (const kind of ["incomplete", "error", "timeout"]) {
    const input = request();
    try {
      const failed = failure(() => collectCaptureBody(input, true, 25), kind === "timeout" ? "REQUEST_TIMEOUT" : "INVALID_REQUEST");
      if (kind === "incomplete") { input.complete = false; input.push(Buffer.from("synthetic")); input.push(null); }
      if (kind === "error") input.destroy(new Error("synthetic-private-stream-message"));
      await failed;
      expect(input.listenerCount("data")).toBe(0);
      expect(input.listenerCount("end")).toBe(0);
    } finally { input.destroy(); input.socket.destroy(); }
  }
});

test("capture composition requires an explicit downstream handler and a bounded body deadline", async () => {
  const { createCaptureRouter } = await import("../../apps/api/src/routes/capture.js");
  expect(() => createCaptureRouter(undefined as unknown as Parameters<typeof createCaptureRouter>[0])).toThrow(TypeError);
  for (const bodyTimeoutMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 30_001]) {
    expect(() => createCaptureRouter({ tokens: { requireEnabledForCapture: async () => { throw new Error("Not invoked"); } },
      handle: async () => {}, bodyTimeoutMs })).toThrow(TypeError);
  }
});

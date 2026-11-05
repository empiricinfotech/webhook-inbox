import type { IncomingMessage } from "node:http";
import { ApiError } from "../errors.js";

export const MAX_CAPTURE_BYTES = 256 * 1024;
export const CAPTURE_BODY_TIMEOUT_MS = 10_000;

export function declaredCaptureLength(request: IncomingMessage): number | undefined {
  const value = request.headers["content-length"];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new ApiError("INVALID_REQUEST");
  if (BigInt(value) > BigInt(MAX_CAPTURE_BYTES)) throw new ApiError("PAYLOAD_TOO_LARGE");
  return Number(value);
}

export interface RawCaptureBody { bytes: Buffer; receivedBytes: number }
// Trusted route-local validator; false rejects without exposing a decoder exception.
export interface CaptureBodyValidation { write(chunk: Buffer): boolean; end(): boolean }

// Keep original bytes; optional validation never replaces them. No decompression, parser or storage.
// The caller closes rejected transports; private input is never logged here.
export function collectCaptureBody(request: IncomingMessage, retain: boolean, timeoutMs = CAPTURE_BODY_TIMEOUT_MS, validation?: CaptureBodyValidation): Promise<RawCaptureBody> {
  const expected = declaredCaptureLength(request);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError("Invalid capture body deadline");
  if (request.destroyed || request.readableEnded || request.readableEncoding !== null) throw new ApiError("INVALID_REQUEST");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0, settled = false;
    const timer = setTimeout(() => fail("REQUEST_TIMEOUT"), timeoutMs);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("close", onClose);
    };
    const fail = (code: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "REQUEST_TIMEOUT" | "UNSUPPORTED_MEDIA_TYPE") => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      request.pause();
      // A reset can emit error before close after listeners are cleaned up. Never retain its cause.
      const ignore = () => {};
      if (!request.closed) {
        request.on("error", ignore);
        request.once("close", () => request.removeListener("error", ignore));
      }
      reject(new ApiError(code));
    };
    const onData = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) { fail("INVALID_REQUEST"); return; }
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_CAPTURE_BYTES) { fail("PAYLOAD_TOO_LARGE"); return; }
      if (validation && !validation.write(chunk)) { fail("UNSUPPORTED_MEDIA_TYPE"); return; }
      if (retain) chunks.push(chunk);
    };
    const onEnd = () => {
      if (!request.complete || expected !== undefined && expected !== receivedBytes) { fail("INVALID_REQUEST"); return; }
      if (validation && !validation.end()) { fail("UNSUPPORTED_MEDIA_TYPE"); return; }
      settled = true;
      cleanup();
      const bytes = retain ? Buffer.concat(chunks, receivedBytes) : Buffer.alloc(0);
      chunks.length = 0;
      resolve({ bytes, receivedBytes });
    };
    const onError = () => fail("INVALID_REQUEST");
    const onClose = () => { if (!settled) fail("INVALID_REQUEST"); };
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("close", onClose);
    request.on("data", onData);
  });
}

import { MIMEType, TextDecoder } from "node:util";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { ApiError } from "../errors.js";
import type { CaptureBodyValidation } from "./raw-body.js";

export function readCaptureContentType(headers: Readonly<IncomingHttpHeaders>) {
  const value = headers["content-type"];
  if (value === undefined) return { media: null, charset: null, issue: "missing_content_type" as const };
  if (typeof value !== "string" || value.length > 512) return { media: null, charset: null, issue: "invalid_content_type" as const };
  try {
    const mime = new MIMEType(value);
    return { media: mime.essence, charset: mime.params.get("charset")?.toLowerCase() ?? null, issue: null };
  } catch { return { media: null, charset: null, issue: "invalid_content_type" as const }; }
}
export function captureFormat(media: string | null): "json" | "form" | "text" | null {
  if (media === "application/json" || media?.startsWith("application/") && media.endsWith("+json")) return "json";
  if (media === "application/x-www-form-urlencoded") return "form";
  return media?.startsWith("text/") ? "text" : null;
}
export function isUtf8Charset(charset: string | null) { return charset === null || ["utf-8", "utf8"].includes(charset); }
export function isIdentityEncoding(value: unknown) {
  return value === undefined || typeof value === "string" && value.trim().toLowerCase() === "identity";
}
function textOnly(text: string) {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code >= 127 && code <= 159)) return false;
  }
  return true;
}

// Header preflight runs before token lookup/100-continue. No input enters the error.
export function createCaptureMediaValidation(request: Pick<IncomingMessage, "headers" | "headersDistinct">,
  declaredLength: number | undefined): CaptureBodyValidation {
  for (const name of ["content-type", "content-encoding"]) {
    if ((request.headersDistinct[name]?.length ?? 0) > 1) throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }
  const type = readCaptureContentType(request.headers);
  const mayHaveBody = (declaredLength ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;
  if (!isIdentityEncoding(request.headers["content-encoding"])
    || type.issue !== null && (type.issue !== "missing_content_type" || mayHaveBody)
    || type.media !== null && (!captureFormat(type.media) || !isUtf8Charset(type.charset))) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }
  // Inspect incremental UTF-8 without retaining text or altering the original buffers.
  // GET/HEAD use this too, while the collector continues to discard their bodies.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return {
    write(chunk) { try { return textOnly(decoder.decode(chunk, { stream: true })); } catch { return false; } },
    end() { try { return textOnly(decoder.decode()); } catch { return false; } },
  };
}

import { MIMEType, TextDecoder } from "node:util";
import type { IncomingHttpHeaders } from "node:http";
import type { RawCaptureInput } from "../routes/capture.js";
import { ApiError } from "../errors.js";
import { MAX_CAPTURE_BYTES } from "./raw-body.js";

export const MAX_JSON_DEPTH = 64;
export const MAX_FORM_FIELDS = 1000;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ParseFailure = "missing_content_type" | "invalid_content_type" | "unsupported_media"
  | "unsupported_charset" | "encoded_body" | "invalid_utf8" | "invalid_json" | "json_depth" | "invalid_form" | "form_fields";
export type CaptureBody =
  | { format: "metadata"; parseFailed: false; value: null }
  | { format: "json"; parseFailed: false; value: JsonValue }
  | { format: "form"; parseFailed: false; value: [string, string][] }
  | { format: "text"; parseFailed: false; value: string }
  | { format: "unparsed"; parseFailed: true; value: null; reason: ParseFailure };
export interface PreparedCapture {
  inbox: RawCaptureInput["inbox"];
  metadata: {
    method: RawCaptureInput["method"];
    receivedAt: string;
    receivedBytes: number;
    contentType: string | null;
    safeHeaders: Record<string, string>;
  };
  body: CaptureBody;
}

function contentType(headers: Readonly<IncomingHttpHeaders>) {
  const value = headers["content-type"];
  if (value === undefined) return { media: null, charset: null, issue: "missing_content_type" as const };
  if (typeof value !== "string" || value.length > 512) return { media: null, charset: null, issue: "invalid_content_type" as const };
  try {
    const mime = new MIMEType(value);
    return { media: mime.essence, charset: mime.params.get("charset")?.toLowerCase() ?? null, issue: null };
  } catch { return { media: null, charset: null, issue: "invalid_content_type" as const }; }
}
function failed(reason: ParseFailure): CaptureBody { return { format: "unparsed", parseFailed: true, value: null, reason }; }

function parseJson(text: string): CaptureBody {
  let value: JsonValue;
  // No reviver, eval, function construction, object merge or user-supplied callbacks.
  try { value = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text) as JsonValue; }
  catch { return failed("invalid_json"); }
  const pending: [JsonValue, number][] = [[value, 1]];
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (typeof node === "number" && !Number.isFinite(node)) return failed("invalid_json");
    if (node !== null && typeof node === "object") {
      if (depth > MAX_JSON_DEPTH) return failed("json_depth");
      for (const child of Object.values(node)) pending.push([child, depth + 1]);
    }
  }
  return { format: "json", parseFailed: false, value };
}
function parseForm(text: string): CaptureBody {
  const fields: [string, string][] = [];
  for (const part of text.split("&")) {
    if (part === "") continue;
    if (fields.length === MAX_FORM_FIELDS) return failed("form_fields");
    const separator = part.indexOf("=");
    const name = separator < 0 ? part : part.slice(0, separator);
    const value = separator < 0 ? "" : part.slice(separator + 1);
    // Strict UTF-8 percent decoding: malformed escapes fail instead of silently replacing data.
    try { fields.push([decodeURIComponent(name.replace(/\+/g, " ")), decodeURIComponent(value.replace(/\+/g, " "))]); }
    catch { return failed("invalid_form"); }
  }
  // Ordered pairs preserve duplicates and treat brackets/__proto__ as literal data.
  return { format: "form", parseFailed: false, value: fields };
}

// Private intermediate representation, NOT sanitized persistence/API output.
// The caller retains raw input for later verification; this function never modifies it.
export function prepareCapture(input: RawCaptureInput): PreparedCapture {
  if (!Number.isSafeInteger(input.receivedBytes) || input.receivedBytes < 0 || input.receivedBytes > MAX_CAPTURE_BYTES
    || !(input.receivedAt instanceof Date) || !Number.isFinite(input.receivedAt.getTime())) throw new ApiError("INVALID_REQUEST");
  const metadataOnly = input.method === "GET" || input.method === "HEAD";
  if (input.rawBody.length !== (metadataOnly ? 0 : input.receivedBytes)) throw new ApiError("INVALID_REQUEST");
  const type = contentType(input.headers);
  const metadata = { method: input.method, receivedAt: input.receivedAt.toISOString(), receivedBytes: input.receivedBytes,
    contentType: type.media, safeHeaders: type.media === null ? {} : { "content-type": type.media } };
  const result = (body: CaptureBody): PreparedCapture => ({ inbox: input.inbox, metadata, body });
  if (metadataOnly) return result({ format: "metadata", parseFailed: false, value: null });
  if (type.issue) return result(failed(type.issue));
  const encoding = input.headers["content-encoding"];
  if (encoding !== undefined && (typeof encoding !== "string" || encoding.trim().toLowerCase() !== "identity")) return result(failed("encoded_body"));
  if (type.charset !== null && !["utf-8", "utf8"].includes(type.charset)) return result(failed("unsupported_charset"));
  const json = type.media === "application/json" || type.media!.startsWith("application/") && type.media!.endsWith("+json");
  const form = type.media === "application/x-www-form-urlencoded";
  if (!json && !form && !type.media!.startsWith("text/")) return result(failed("unsupported_media"));
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.rawBody); }
  catch { return result(failed("invalid_utf8")); }
  return result(json ? parseJson(text) : form ? parseForm(text) : { format: "text", parseFailed: false, value: text });
}

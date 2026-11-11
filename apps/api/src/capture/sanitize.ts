import { prepareCapture, type CaptureBody, type JsonValue, type PreparedCapture } from "./prepare.js";
import type { RawCaptureInput } from "../routes/capture.js";

export const DEFAULT_SENSITIVE_JSON_KEYS = Object.freeze([
  "authorization", "cookie", "password", "passwd", "secret", "token", "access_token",
  "refresh_token", "api_key", "apikey", "client_secret", "clientsecret",
]);
export const MAX_CUSTOM_REDACTION_KEYS = 64;
export const MAX_REDACTION_KEY_LENGTH = 128;
export interface CaptureRedactionOptions {
  // Trusted server/inbox policy, never derived from inbound headers, query or body.
  sensitiveJsonKeys?: readonly string[];
  captureBody?: boolean;
}
export interface SanitizedCapture {
  inbox: PreparedCapture["inbox"];
  metadata: PreparedCapture["metadata"];
  body: CaptureBody | { format: "omitted"; parseFailed: false; value: null };
  redaction: { headerPolicy: "content-type-only"; jsonKeysRemoved: number; bodyOmitted: boolean };
}

// Compile/snapshot trusted configuration once; malformed policy fails closed.
export function createCaptureSanitizer(options: CaptureRedactionOptions = {}) {
  const custom = options?.sensitiveJsonKeys === undefined ? [] : options.sensitiveJsonKeys;
  if (!options || typeof options !== "object" || Array.isArray(options) || options.captureBody !== undefined && typeof options.captureBody !== "boolean"
    || !Array.isArray(custom) || custom.length > MAX_CUSTOM_REDACTION_KEYS
    || Array.from(custom).some(key => typeof key !== "string" || key.length < 1 || key.length > MAX_REDACTION_KEY_LENGTH
      || [...key].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
    throw new TypeError("Invalid capture redaction policy");
  }
  const keys = new Set([...DEFAULT_SENSITIVE_JSON_KEYS, ...custom].map(key => key.toLowerCase()));
  const captureBody = options.captureBody !== false;
  return (input: RawCaptureInput): SanitizedCapture => {
    // Preparation reprojects headers to normalized content-type ONLY. No credential,
    // provider signature, arbitrary header, URL, query or original bytes enter output.
    const prepared = prepareCapture(input);
    let jsonKeysRemoved = 0;
    const redact = (value: JsonValue): JsonValue => {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(redact);
      const result: { [key: string]: JsonValue } = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        if (keys.has(key.toLowerCase())) { jsonKeysRemoved++; continue; }
        result[key] = redact(child);
      }
      return result;
    };
    let body: SanitizedCapture["body"];
    if (!captureBody && prepared.body.format !== "metadata") body = { format: "omitted", parseFailed: false, value: null };
    else if (prepared.body.format === "json") body = { ...prepared.body, value: redact(prepared.body.value) };
    else body = prepared.body;
    return { inbox: { inboxId: prepared.inbox.inboxId, workspaceId: prepared.inbox.workspaceId,
      enabled: prepared.inbox.enabled, retentionDays: prepared.inbox.retentionDays }, metadata: prepared.metadata, body,
      redaction: { headerPolicy: "content-type-only", jsonKeysRemoved, bodyOmitted: body.format === "omitted" } };
  };
}

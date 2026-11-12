import { Types, type Connection } from "mongoose";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { MAX_CAPTURE_BYTES } from "../capture/raw-body.js";
import type { SanitizedCapture } from "../capture/sanitize.js";
import { safeStorageOperation } from "./storage-operation.js";

const failureReason = z.enum(["missing_content_type", "invalid_content_type", "unsupported_media", "unsupported_charset",
  "encoded_body", "invalid_utf8", "invalid_json", "json_depth", "invalid_form", "form_fields"]);
// Strict allowlist at the storage boundary. No request headers, URL, token, raw bytes,
// driver error, or unvalidated caller-supplied document can enter this collection.
export const captureEventSchema = z.strictObject({
  _id: z.instanceof(Types.ObjectId), workspaceId: z.instanceof(Types.ObjectId), inboxId: z.instanceof(Types.ObjectId),
  receivedAt: z.date(), expiresAt: z.date(), method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
  receivedBytes: z.number().int().min(0).max(MAX_CAPTURE_BYTES),
  contentType: z.string().max(512).nullable(), safeHeaders: z.strictObject({ "content-type": z.string().max(512).optional() }),
  format: z.enum(["metadata", "json", "form", "text", "unparsed", "omitted"]),
  safeBody: z.string().nullable(), parseFailed: z.boolean(), parseFailureReason: failureReason.nullable(),
  redaction: z.strictObject({ headerPolicy: z.literal("content-type-only"), jsonKeysRemoved: z.number().int().nonnegative(), bodyOmitted: z.boolean() }),
  signatureState: z.literal("unverified"),
}).superRefine((event, context) => {
  const hasBody = event.format === "json" || event.format === "form" || event.format === "text";
  if ((event.safeBody !== null) !== hasBody || event.parseFailed !== (event.format === "unparsed")
    || (event.parseFailureReason !== null) !== event.parseFailed || event.redaction.bodyOmitted !== (event.format === "omitted")
    || event.expiresAt <= event.receivedAt) context.addIssue({ code: "custom", message: "Invalid event" });
});

export function createCaptureEventStore(connection: Connection) {
  const events = connection.collection("events");
  return async (capture: SanitizedCapture): Promise<string> => {
    const body = capture.body;
    // Store serialized sanitized JSON/form as BSON strings, not Mongo field names:
    // arbitrary keys such as dots, dollars, NUL and __proto__ remain inert data.
    const safeBody = body.format === "json" || body.format === "form" ? JSON.stringify(body.value)
      : body.format === "text" ? body.value : null;
    const receivedAt = new Date(capture.metadata.receivedAt);
    const retention = capture.inbox.retentionDays;
    if (![1, 7, 30].includes(retention) || capture.inbox.enabled !== true) throw new ApiError("INTERNAL_ERROR");
    const id = new Types.ObjectId();
    const candidate = {
      _id: id, workspaceId: capture.inbox.workspaceId, inboxId: capture.inbox.inboxId,
      receivedAt, expiresAt: new Date(receivedAt.getTime() + retention * 24 * 60 * 60 * 1000),
      method: capture.metadata.method, receivedBytes: capture.metadata.receivedBytes,
      contentType: capture.metadata.contentType, safeHeaders: capture.metadata.safeHeaders,
      format: body.format, safeBody, parseFailed: body.parseFailed,
      parseFailureReason: body.format === "unparsed" ? body.reason : null,
      redaction: capture.redaction, signatureState: "unverified" as const,
    };
    const parsed = captureEventSchema.safeParse(candidate);
    if (!parsed.success) throw new ApiError("INTERNAL_ERROR");
    // Only report success after majority journal acknowledgement. A failure or
    // deadline can be ambiguous: Mongo may have committed before the error arrived.
    await safeStorageOperation(async () => {
      const result = await events.insertOne(parsed.data, {
        writeConcern: { w: "majority", journal: true }, timeoutMS: 10_000,
      });
      if (!result.acknowledged || !result.insertedId.equals(id)) throw new ApiError("STORAGE_UNAVAILABLE");
    });
    return id.toHexString();
  };
}

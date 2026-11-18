import { z } from "zod";
import { identifierSchema } from "./identifiers.js";

export const DEFAULT_EVENT_LIST_LIMIT = 25;

// This metadata-only DTO deliberately excludes safeBody until event inspection is
// implemented. A database field added later cannot expose payloads through the list.
export const inboxEventSummarySchema = z.strictObject({
  id: identifierSchema,
  receivedAt: z.iso.datetime(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
  receivedBytes: z.number().int().min(0),
  contentType: z.string().max(512).nullable(),
  format: z.enum(["metadata", "json", "form", "text", "unparsed", "omitted"]),
  parseFailed: z.boolean(),
  signatureState: z.literal("unverified"),
});
export type InboxEventSummary = z.output<typeof inboxEventSummarySchema>;

export const inboxEventListResponseSchema = z.strictObject({
  data: z.array(inboxEventSummarySchema).max(DEFAULT_EVENT_LIST_LIMIT),
});
export type InboxEventListResponse = z.output<typeof inboxEventListResponseSchema>;

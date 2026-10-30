import { z } from "zod";
import { identifierSchema } from "./identifiers.js";

export const INBOX_NAME_MAX_LENGTH = 100;
export const INBOX_DESCRIPTION_MAX_LENGTH = 500;
export const RETENTION_DAYS = [1, 7, 30] as const;
export const DEFAULT_RETENTION_DAYS = 7;
export const inboxNameSchema = z.string().trim().min(1).max(INBOX_NAME_MAX_LENGTH)
  .refine((value) => [...value].every((character) =>
    character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
export const createInboxSchema = z.strictObject({
  name: inboxNameSchema,
  description: z.string().trim().max(INBOX_DESCRIPTION_MAX_LENGTH).refine((value) =>
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127 || code === 9 || code === 10 || code === 13;
    })).default(""),
  retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(DEFAULT_RETENTION_DAYS),
});
// Explicit DTO: adding a database field never adds it to a management response.
export const inboxSummarySchema = z.strictObject({
  id: identifierSchema, workspaceId: identifierSchema,
  name: inboxNameSchema, description: z.string(), enabled: z.boolean(),
  retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export type InboxSummary = z.output<typeof inboxSummarySchema>;

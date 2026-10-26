import { z } from "zod";

// ObjectIds cross the API boundary as canonical strings, never database objects.
export const identifierSchema = z.string().regex(/^[0-9a-fA-F]{24}$/)
  .transform((value) => value.toLowerCase());
export type Identifier = z.output<typeof identifierSchema>;

export const REQUEST_ID_HEADER = "X-Request-Id";
export const requestIdSchema = z.uuid({ version: "v4" });
export type RequestId = z.output<typeof requestIdSchema>;

import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_CURSOR_LENGTH = 512;

// Opaque URL-safe transport token only. Event cursor encoding/querying is D08.2.
export const cursorSchema = z.string().min(1).max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
export type Cursor = z.output<typeof cursorSchema>;

const queryLimitSchema = z.string().regex(/^[1-9][0-9]{0,2}$/)
  .transform(Number).pipe(z.number().int().min(1).max(MAX_PAGE_SIZE));
export const paginationQuerySchema = z.strictObject({
  limit: queryLimitSchema.default(DEFAULT_PAGE_SIZE),
  cursor: cursorSchema.optional(),
});
export type PaginationQuery = z.output<typeof paginationQuerySchema>;

export function pageResponseSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    data: z.array(item).max(MAX_PAGE_SIZE),
    nextCursor: cursorSchema.nullable(),
  });
}
export interface Page<T> {
  data: T[];
  nextCursor: Cursor | null;
}

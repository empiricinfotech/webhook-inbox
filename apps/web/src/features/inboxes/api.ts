import { z } from "zod";
import { inboxSummarySchema, type InboxSummary } from "@empiric-webhook-inbox/contracts/inboxes";
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { pageResponseSchema } from "@empiric-webhook-inbox/contracts/pagination";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";

export class InboxRequestError extends Error {
  constructor(public readonly code: string = "UNAVAILABLE", public readonly requestId?: string) {
    super(code === "NOT_FOUND" ? "This inbox or local workspace is unavailable."
      : code === "INVALID_REQUEST" ? "Check the inbox name and description."
      : "Unable to reach the local inbox service.");
  }
}
export async function requestJson<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, cache: "no-store", credentials: "same-origin",
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
    const json: unknown = await response.json();
    if (!response.ok) {
      const error = apiErrorResponseSchema.safeParse(json);
      throw new InboxRequestError(error.success ? error.data.error.code : "UNAVAILABLE",
        error.success ? error.data.error.requestId : undefined);
    }
    const result = schema.safeParse(json);
    if (!result.success) throw new InboxRequestError();
    return result.data;
  } catch (error) {
    if (error instanceof InboxRequestError) throw error;
    throw new InboxRequestError();
  }
}
const workspaceResponse = z.strictObject({ data: z.strictObject({ id: identifierSchema, name: z.string().min(1).max(100) }) });
const inboxResponse = z.strictObject({ data: inboxSummarySchema });
export const fetchWorkspace = (signal?: AbortSignal) => requestJson("/local-workspace", workspaceResponse, { signal: signal ?? null });
export const fetchInboxes = (workspaceId: string, cursor?: string, signal?: AbortSignal) => requestJson(
  `/workspaces/${encodeURIComponent(workspaceId)}/inboxes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  pageResponseSchema(inboxSummarySchema), { signal: signal ?? null });
export const fetchInbox = (id: string, signal?: AbortSignal) => requestJson(`/inboxes/${encodeURIComponent(id)}`, inboxResponse, { signal: signal ?? null });
export const createInbox = (workspaceId: string, input: { name: string; description: string }): Promise<{ data: InboxSummary }> => requestJson(
  `/workspaces/${encodeURIComponent(workspaceId)}/inboxes`, inboxResponse,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });

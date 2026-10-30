import { expect, test, vi } from "vitest";
import { z } from "zod";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { createErrorResponse } from "@empiric-webhook-inbox/contracts/errors";
import { readWebOrigin } from "../../apps/api/src/config/local-dashboard.js";
import { createInbox, fetchInbox, fetchInboxes, InboxRequestError, requestJson } from "../../apps/web/src/features/inboxes/api.js";

const id = "0123456789abcdef01234567";
const summary = { id, workspaceId: id, name: "Synthetic", description: "", enabled: true, retentionDays: 7,
  createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z" };
test("browser client uses same-origin no-store endpoints, explicit JSON and bounded cursor response", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: summary }))
    .mockResolvedValueOnce(Response.json({ data: [summary], nextCursor: "synthetic_cursor" }));
  vi.stubGlobal("fetch", fetch);
  await createInbox(id, { name: "Synthetic", description: "" });
  expect(fetch.mock.calls[0]![0]).toBe(`/api/v1/workspaces/${id}/inboxes`);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Synthetic", description: "" }) });
  await fetchInboxes(id, "synthetic_cursor");
  expect(fetch.mock.calls[1]![0]).toBe(`/api/v1/workspaces/${id}/inboxes?cursor=synthetic_cursor`);
});
test("response allowlist refuses hidden credentials, HTML responses and noncontract payloads", async () => {
  for (const response of [Response.json({ data: { ...summary, tokenHash: "synthetic-private-value" } }),
    new Response("synthetic-private-value", { status: 502 }), Response.json({ unexpected: "synthetic-private-value" })]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    try { await fetchInbox(id); throw new Error("Expected client rejection"); }
    catch (error) { expect(error instanceof InboxRequestError).toBe(true); expect(String(error).includes("synthetic-private-value")).toBe(false); }
  }
});
test("client errors preserve safe request correlation and avoid automatic mutation retries", async () => {
  const requestId = "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5";
  const fetch = vi.fn().mockResolvedValue(Response.json(createErrorResponse("NOT_FOUND", requestId), { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchInbox(id)).rejects.toMatchObject({ code: "NOT_FOUND", requestId });
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockRejectedValueOnce(new Error("synthetic-private-driver-error"));
  await expect(requestJson("/synthetic", z.unknown())).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
test("local web origin config rejects credentials, paths, external/DNS origins and non-HTTP schemes", () => {
  expect(readWebOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  for (const value of ["https://example.com", "http://localhost:3000", "http://127.0.0.1:3000/path", "http://127.0.0.1:3000?q=x", "http://synthetic:private@127.0.0.1:3000", "bad"]) {
    expect(() => readWebOrigin(value)).toThrow(EnvironmentConfigurationError);
  }
});

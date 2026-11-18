"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_EVENT_LIST_LIMIT } from "@empiric-webhook-inbox/contracts/events";
import type { InboxEventSummary } from "@empiric-webhook-inbox/contracts/events";
import { fetchInboxEvents } from "./api";
import { InboxRequestError } from "./api";

function formatName(event: InboxEventSummary) {
  if (event.format === "json") return "JSON";
  if (event.format === "form") return "Form";
  if (event.format === "text") return "Text";
  if (event.format === "unparsed") return "Unparsed";
  if (event.format === "omitted") return "Body omitted";
  if (event.format === "metadata") return "Metadata only";
  return "Unknown";
}

export function InboxEventList({ inboxId, workspaceId }: { inboxId: string; workspaceId: string }) {
  const events = useQuery({ queryKey: ["inbox-events", workspaceId, inboxId],
    queryFn: ({ signal }) => fetchInboxEvents(inboxId, signal), retry: false });

  return <section className="panel event-panel" aria-labelledby="events-heading">
    <div className="event-list-header">
      <div><h2 id="events-heading">Captured requests</h2>
        <p className="muted">The list shows request metadata. Payload inspection is a later step.</p></div>
      <button className="button secondary" disabled={events.isFetching} onClick={() => void events.refetch()}>
        {events.isFetching ? "Refreshing…" : "Refresh requests"}
      </button>
    </div>
    {events.isPending ? <p className="event-state" role="status">Loading captured requests…</p>
      : events.isError && !events.data ? <div className="event-state" role="alert">
        <h3>{events.error instanceof InboxRequestError && events.error.code === "NOT_FOUND" ? "Inbox not available" : "Requests could not be loaded"}</h3>
        <p>{events.error.message}</p>
        {events.error instanceof InboxRequestError && events.error.requestId
          ? <p className="muted">Request ID: <code>{events.error.requestId}</code></p> : null}
        <button className="button" onClick={() => void events.refetch()}>Try again</button>
      </div>
        : events.data?.data.length === 0 ? <div className="event-state">
          <h3>No requests captured yet</h3>
          <p>This inbox has no recorded requests. Capture links are not shown in this preview yet.</p>
        </div>
          : <>
            <p className="muted small" role="status">Showing up to the {DEFAULT_EVENT_LIST_LIMIT} most recent requests.</p>
            {events.isError ? <p className="event-refresh-error" role="status">The latest refresh failed; showing the previously loaded requests.</p> : null}
            <ol className="event-list" aria-label="Captured requests">
              {events.data?.data.map((event) => <li className="event-card" key={event.id}>
                <div className="event-card-heading">
                  <span className="event-method">{event.method}</span>
                  <time dateTime={event.receivedAt}>{new Date(event.receivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                <dl className="event-metadata">
                  <div><dt>Event ID</dt><dd><code>{event.id}</code></dd></div>
                  <div><dt>Format</dt><dd>{formatName(event)}{event.parseFailed ? " · parse failed" : ""}</dd></div>
                  <div><dt>Size</dt><dd>{event.receivedBytes.toLocaleString()} bytes</dd></div>
                  <div><dt>Content type</dt><dd>{event.contentType ?? "Not provided"}</dd></div>
                  <div><dt>Signature</dt><dd>Unverified</dd></div>
                </dl>
              </li>)}
            </ol>
          </>}
  </section>;
}

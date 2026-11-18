"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInbox } from "./api";
import { InboxEventList } from "./inbox-event-list";
import { InboxFailure, LoadingInbox, useLocalWorkspace } from "./shared";

export function InboxDetail({ id }: { id: string }) {
  const workspace = useLocalWorkspace();
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryKey: ["inbox", workspace.data?.data.id, id],
    queryFn: ({ signal }) => fetchInbox(id, signal), enabled: Boolean(workspace.data), retry: false });
  if (workspace.isError) return <InboxFailure error={workspace.error} retry={() => void workspace.refetch().then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }))} />;
  if (workspace.isPending || inbox.isPending) return <LoadingInbox message="Loading inbox details…" />;
  if (inbox.isError) return <InboxFailure error={inbox.error} retry={() => void inbox.refetch()} />;
  const data = inbox.data.data;
  return <>
    <div className="inbox-toolbar"><p className="muted">{workspace.data.data.name}</p>
      <button className="button secondary" disabled={inbox.isFetching} onClick={() => void inbox.refetch()}>{inbox.isFetching ? "Refreshing…" : "Refresh details"}</button></div>
    <section className="panel inbox-detail" aria-labelledby="inbox-title">
      <span className={`status-pill ${data.enabled ? "" : "disabled"}`}>{data.enabled ? "Enabled" : "Disabled"}</span>
      <h2 id="inbox-title">{data.name}</h2><p className="inbox-description">{data.description || "No description added."}</p>
      <dl className="inbox-metadata"><div><dt>Retention</dt><dd>{data.retentionDays} days</dd></div>
        <div><dt>Created (UTC)</dt><dd><time dateTime={data.createdAt}>{data.createdAt.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC")}</time></dd></div>
        <div><dt>Inbox ID</dt><dd><code>{data.id}</code></dd></div></dl>
    </section>
    <InboxEventList inboxId={id} workspaceId={workspace.data.data.id} />
    <Link href="/inboxes">← Back to inboxes</Link>
  </>;
}

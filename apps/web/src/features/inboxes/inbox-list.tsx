"use client";

import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInboxes } from "./api";
import { InboxFailure, LoadingInbox, useLocalWorkspace } from "./shared";

export function InboxList() {
  const workspace = useLocalWorkspace();
  const queryClient = useQueryClient();
  const id = workspace.data?.data.id;
  const list = useInfiniteQuery({ queryKey: ["inboxes", id],
    queryFn: ({ pageParam, signal }) => fetchInboxes(id!, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined, enabled: Boolean(id), retry: false });
  if (workspace.isError) return <InboxFailure error={workspace.error} retry={() => void workspace.refetch().then(() => queryClient.invalidateQueries({ queryKey: ["inboxes"] }))} />;
  if (workspace.isPending || list.isPending) return <LoadingInbox />;
  if (list.isError && !list.data) return <InboxFailure error={list.error} retry={() => void list.refetch()} />;
  const inboxes = list.data?.pages.flatMap((page) => page.data) ?? [];
  return <>
    <div className="inbox-toolbar"><p className="muted">{workspace.data.data.name}</p>
      <div className="inbox-actions"><button className="button secondary" disabled={list.isFetching} onClick={() => void list.refetch()}>
        {list.isFetching ? "Refreshing…" : "Refresh"}</button><Link className="button" href="/inboxes/new">Create inbox <span aria-hidden="true">＋</span></Link></div>
    </div>
    {list.isError ? <p role="alert">Could not refresh the list. Showing previously loaded inboxes. <button className="text-button" onClick={() => void list.refetch()}>Retry</button></p> : null}
    {inboxes.length === 0 ? <section className="panel inbox-state" aria-labelledby="empty-heading">
      <span className="empty-icon" aria-hidden="true">↙</span><h2 id="empty-heading">Your first inbox starts here.</h2>
      <p>Give each integration its own place. Start with a name and a short description.</p>
      <Link className="button" href="/inboxes/new">Create your first inbox</Link>
    </section> : <ul className="inbox-grid" aria-label="Inboxes">
      {inboxes.map((inbox) => <li key={inbox.id}><Link className="inbox-card" href={`/inboxes/${inbox.id}`}>
        <div className="inbox-card-top"><span className={`status-pill ${inbox.enabled ? "" : "disabled"}`}>{inbox.enabled ? "Enabled" : "Disabled"}</span><span aria-hidden="true">↗</span></div>
        <h2>{inbox.name}</h2><p className="inbox-description">{inbox.description || "No description added."}</p>
        <span className="muted small">{inbox.retentionDays}-day retention · View inbox</span>
      </Link></li>)}
    </ul>}
    {list.hasNextPage ? <button className="button secondary" disabled={list.isFetching} onClick={() => void list.fetchNextPage()}>
      {list.isFetchingNextPage ? "Loading more…" : "Load more inboxes"}</button> : null}
    <p className="notice">Inbox setup is available now. Capturing requests is coming in the local preview.</p>
  </>;
}

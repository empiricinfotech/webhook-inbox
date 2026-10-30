"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspace, InboxRequestError } from "./api";

export function useLocalWorkspace() {
  return useQuery({ queryKey: ["local-workspace"], queryFn: ({ signal }) => fetchWorkspace(signal), retry: false });
}
export function LoadingInbox({ message = "Loading your inboxes…" }: { message?: string }) {
  return <p className="inbox-state" role="status">{message}</p>;
}
export function InboxFailure({ error, retry }: { error: Error; retry: () => void }) {
  return <section className="panel inbox-state" role="alert">
    <h2>{error instanceof InboxRequestError && error.code === "NOT_FOUND" ? "Inbox not available" : "Connection interrupted"}</h2>
    <p>{error.message}</p>
    <p>Check that the local dashboard API is running and your workspace has been bootstrapped.</p>
    {error instanceof InboxRequestError && error.requestId ? <p className="muted">Request ID: <code>{error.requestId}</code></p> : null}
    <div className="inbox-actions"><button className="button" onClick={retry}>Try again</button><Link href="/setup">Local setup</Link></div>
  </section>;
}

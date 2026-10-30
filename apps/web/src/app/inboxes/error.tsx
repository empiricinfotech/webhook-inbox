"use client";

import Link from "next/link";
export default function InboxError({ reset }: { reset: () => void }) {
  return <div className="page"><section className="panel" role="alert">
    <h1>Unable to open inboxes</h1><p>The screen could not be loaded. Try opening it again.</p>
    <div className="inbox-actions"><button className="button" onClick={reset}>Try again</button><Link href="/inboxes">Back to inboxes</Link></div>
  </section></div>;
}

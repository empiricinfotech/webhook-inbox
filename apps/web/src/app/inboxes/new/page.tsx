import Link from "next/link";
import type { Metadata } from "next";
import { InboxCreate } from "../../../features/inboxes/inbox-create";
export const metadata: Metadata = { title: "Create inbox" };
export default function NewInboxPage() {
  return <div className="page inbox-page"><Link className="back-link" href="/inboxes">← Inboxes</Link>
    <p className="eyebrow">A new integration</p><h1>Create an inbox</h1><p className="intro">Keep your test integrations organized.</p><InboxCreate /></div>;
}

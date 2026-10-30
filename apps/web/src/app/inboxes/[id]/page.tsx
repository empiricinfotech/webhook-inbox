import Link from "next/link";
import type { Metadata } from "next";
import { InboxDetail } from "../../../features/inboxes/inbox-detail";
export const metadata: Metadata = { title: "Inbox details" };
export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="page inbox-page"><Link className="back-link" href="/inboxes">← Inboxes</Link>
    <p className="eyebrow">Integration settings</p><h1>Inbox details</h1><InboxDetail id={id} /></div>;
}

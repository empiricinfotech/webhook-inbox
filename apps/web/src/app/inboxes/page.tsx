import type { Metadata } from "next";
import { InboxList } from "../../features/inboxes/inbox-list";
export const metadata: Metadata = { title: "Inboxes" };
export default function InboxesPage() {
  return <div className="page inbox-page"><p className="eyebrow">Local workspace</p><h1>Inboxes</h1>
    <p className="intro">A place for every integration you’re working on.</p><InboxList /></div>;
}

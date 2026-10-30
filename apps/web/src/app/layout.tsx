import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { QueryProvider } from "../lib/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Webhook Inbox", template: "%s | Webhook Inbox" },
  description: "A local workspace for debugging webhook integrations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header">
          <Link className="brand" href="/">Webhook Inbox<span>by Empiric</span></Link>
          <nav aria-label="Main navigation">
            <Link href="/">Overview</Link>
            <Link href="/inboxes">Inboxes</Link>
            <Link href="/setup">Local setup</Link>
          </nav>
        </header>
        <QueryProvider>
          <main id="main" tabIndex={-1}>{children}</main>
        </QueryProvider>
        <footer>Built for integration debugging. Local development only.</footer>
      </body>
    </html>
  );
}

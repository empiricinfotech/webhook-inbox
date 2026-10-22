import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Local setup" };

export default function SetupPage() {
  return (
    <div className="page">
      <p className="eyebrow">Get started</p>
      <h1>Your local workspace.</h1>
      <p className="intro">
        Start the frontend and API in separate terminals after installing the
        repository&apos;s pinned toolchain and running <code>npm run bootstrap</code>.
      </p>
      <section className="panel" aria-labelledby="start-heading">
        <h2 id="start-heading">Start the preview</h2>
        <ol className="setup-steps">
          <li><h3>Terminal one · API</h3><pre><code>API_PORT=4000 npm run dev:api</code></pre>
            <p>Listens on 127.0.0.1:4000. Routes return 404 until their features are added.</p></li>
          <li><h3>Terminal two · Frontend</h3><pre><code>npm run dev:web</code></pre>
            <p>Open http://127.0.0.1:3000 to explore the local shell.</p></li>
        </ol>
        <p className="notice">
          Inbox creation, capture, database storage and API connectivity
          are still being built. Use synthetic data during development.
        </p>
      </section>
      <Link className="text-link" href="/">← Back to overview</Link>
    </div>
  );
}

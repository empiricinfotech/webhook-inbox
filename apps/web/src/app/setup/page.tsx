import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Local setup" };

export default function SetupPage() {
  return (
    <div className="page">
      <p className="eyebrow">Get started</p>
      <h1>Your local workspace.</h1>
      <p className="intro">
        Start MongoDB, then the frontend and API after installing the
        repository&apos;s pinned toolchain and running <code>npm run bootstrap</code>.
      </p>
      <section className="panel" aria-labelledby="start-heading">
        <h2 id="start-heading">Start the preview</h2>
        <ol className="setup-steps">
          <li><h3>Copy local configuration</h3><pre><code>{`cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local`}</code></pre>
            <p>Keep these local files private. Match API_ORIGIN to the API port if you change it.</p></li>
          <li><h3>Start MongoDB</h3><pre><code>docker compose -f infra/compose.mongo.yaml up -d --wait mongo</code></pre>
            <p>The local database listens on 127.0.0.1:27017.</p></li>
          <li><h3>Bootstrap the local workspace once</h3><pre><code>{`npm run local:inbox -- init
npm run local:inbox -- bootstrap`}</code></pre>
            <p>Run init once. It preserves private local configuration by refusing overwrites.</p></li>
          <li><h3>Terminal one · Local inbox API</h3><pre><code>npm run local:dashboard</code></pre>
            <p>Check /health/live and /health/ready at 127.0.0.1:4000.</p></li>
          <li><h3>Terminal two · Frontend</h3><pre><code>npm run dev:web</code></pre>
            <p>Open http://127.0.0.1:3000/inboxes to create and view inboxes.</p></li>
        </ol>
        <p className="notice">
          Development requests under /api/v1 now reach Express through the
          frontend. Create and view inboxes from this preview. Capture is still being built. Use synthetic data during development.
        </p>
      </section>
      <Link className="button" href="/inboxes">Open inboxes</Link>
    </div>
  );
}

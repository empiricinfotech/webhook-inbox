import Link from "next/link";

export default function OverviewPage() {
  return (
    <div className="page">
      <p className="eyebrow">Local preview · In development</p>
      <h1>A clearer view of<br />your webhooks.</h1>
      <p className="intro">
        Find out what arrived, inspect the details, and debug your integrations
        from one place.
      </p>
      <Link className="button" href="/setup">Open local setup <span aria-hidden="true">↗</span></Link>
      <section className="panel" aria-labelledby="preview-heading">
        <p className="eyebrow">The first release</p>
        <h2 id="preview-heading">From request to understanding.</h2>
        <ol className="journey">
          <li><h3>Create an inbox</h3><p>A dedicated capture URL for your integration.</p></li>
          <li><h3>Send a test event</h3><p>Start with a synthetic webhook request.</p></li>
          <li><h3>Inspect and delete</h3><p>Review sanitized details, then clear the sample.</p></li>
        </ol>
        <p className="notice">
          Capture and inspection are coming in the first release.
          This preview currently provides local setup and navigation.
        </p>
      </section>
    </div>
  );
}

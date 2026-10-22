import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <p className="eyebrow">404</p>
      <h1>Page not found.</h1>
      <p className="intro">This page is not part of the local preview.</p>
      <Link className="button" href="/">Back to overview</Link>
    </div>
  );
}

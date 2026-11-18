# Local inbox event list

D08.1 | 18 November 2026

The inbox detail page now reads the 25 most recent captured requests from the
opt-in local dashboard API. The read is scoped to the configured active owner,
workspace and inbox. Results sort by `receivedAt` descending, then ObjectId
descending for a deterministic tie order. No event cursor or receivedAt index is
introduced here; stable cursor paging and the index are D08.2.

The shared strict response contract exposes only the event ID, received time,
method, byte count, normalized content type, body format, parse-failure flag and
signature state. The database projection and browser schema both exclude
`safeBody`, headers, redaction details and any credential fields. Payload display
and safe event inspection remain D09.1/D09.3.

The page gives the event section its own loading, error and empty states. A failed
first load shows a retry action and safe request ID when the API supplied one. A
refresh keeps the existing rows visible if it fails and reports that condition.
An empty inbox says no requests were captured and explains that this preview does
not show capture links. Rows are text and metadata only; no payload is rendered.

The fixed 25-record result is a first list view, not pagination or a total count.
When more events exist they cannot be reached from this view until D08.2. Expired
records are not filtered on read until D18; storage expiry timestamps do not
themselves remove records. Soft deletion is D09.2. The local API remains
loopback-only and must not be exposed through a public proxy or tunnel.

## Verification

```bash
npm test -- tests/api/inbox-events.test.ts tests/unit/inbox-client.test.ts
```

The API tests use owned disposable Mongo and synthetic records to check the empty
result, newest-first ordering, the 25-record bound, workspace/inbox isolation,
safe no-store correlated errors and exclusion of payload text. The client tests
check the same-origin no-store request and reject response fields outside the
metadata allowlist. `npm run lint`, `npm run typecheck`, the full test suite and
the production build are also required for this task. Browser verification
covers the list's visible loading, empty and populated states; the day-level
60-event no-gap/no-duplicate check remains pending with D08.2 and D08.3.

Current task status: **in progress**. The focused tests, full test suite, lint,
typecheck and browser states passed. `npm run build` compiled and completed its
type/static-generation steps, then exited at the installed Next.js security gate
because the lockfile resolves Next.js 16.4.2. No dependency upgrade is included
in this task; rerun the production build after the separately scoped dependency
maintenance decision. D08.2 remains pending until D08.1 verification is complete.

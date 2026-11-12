# Capture security and outage regressions

D07.3 | 12 November 2026

The local capture pipeline is exercised with synthetic data, an owned MongoDB
process/database and a loopback HTTP listener. The tests cover redaction after
actual persistence, hostile HTML as data, oversized/unsupported rejection, and a
real database shutdown and restart. No normal development database or local
configuration is opened, modified, stopped or copied.

```bash
npm test -- tests/api/capture-security.test.ts
```

## What is checked

- A nested JSON fixture contains built-in and configured sensitive keys in objects,
  arrays, nested arrays and a literal `__proto__` key. The test reads the actual
  stored event, verifies eight removed properties and the preserved safe structure,
  and checks that synthetic secrets, authorization/cookie headers, a capture
  token and query values do not appear in the event, response or application logs.
- Synthetic HTML with script tags, an event handler and a JavaScript URL is sent
  as `text/html`. When body capture is enabled, the stored body remains exactly
  that inert text; the 201 response stays JSON and does not reflect its marker.
  When body capture is disabled, the stored body is null and marked omitted.
  The server does not execute this payload. This does **not** test browser event
  rendering: no event-inspection page exists yet. D09 must safely render and test
  hostile text in the actual interface. HTML and other non-JSON text can contain
  secrets; use synthetic data or disable body capture.
- A request above 256 KiB returns 413, and unsupported binary content returns
  415; neither produces a stored event. A subsequent valid text capture succeeds.
  Together with the existing durable JSON/text checks, this demonstrates the
  Day 06 capture/oversize acceptance at the implemented local receiver.
- A valid capture is stored, then the test stops its own real MongoDB process
  after token lookup and before the insert starts. The real driver operation
  returns a correlated, no-store 503 instead of 201; a request while the database
  is down also returns 503. No credential, body, query or database URI is returned
  or logged. Restarting the same isolated database lets the same HTTP listener
  capture again; the earlier acknowledged event remains and the two attempts made
  while Mongo was stopped did not produce records.

The test controls shutdown timing through a one-call wrapper around the actual
Mongo insert; it does not fabricate the database error or replace the production
handler. Its restartable fixture owns its process, port, random database and data
directory, clears its own prior startup log before restarting, waits for a real
ping, and removes its resources on cleanup.

The outage test demonstrates **this particular pre-insert failure**, not that every
503 means nothing was written. D07.2 also tests an intentionally ambiguous
post-insert error, and MongoDB can commit before an acknowledgment is lost. A
manual retry is a separate delivery and may create a duplicate. See
[local capture storage](CAPTURE_STORAGE.md) for write concern and privacy limits.

The Day 07 acceptance is demonstrated: nested synthetic secrets are absent from
stored samples and a real database outage returns 503 rather than success. The
v0.1 capture-inspect-delete journey, UI/CLI token reveal, HTML rendering, expiry
cleanup/read enforcement, quotas, signatures and release gates remain pending.
D08.1 (event list) is the next eligible task and is not started here.

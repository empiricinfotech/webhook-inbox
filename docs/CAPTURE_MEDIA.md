# Capture media rejection policy

D06.3 | 5 November 2026

The optional Express capture router now rejects oversized, unsupported binary
and compressed requests before any downstream handler receives a complete body.
This completes the method/byte/preparation/media components in D06.1–D06.3.
Normal API startup has no capture handler. D07.1 [redaction](CAPTURE_REDACTION.md)
and D07.2 [durable local storage](CAPTURE_STORAGE.md) are now composed in local:dashboard.

## Run the acceptance checks

Use pinned Node 24.22.0/npm 11.19.1 and a native MongoDB 8 fixture binary:

```bash
npm run bootstrap
npm test -- tests/unit/capture-media.test.ts tests/unit/capture-body.test.ts tests/unit/capture-prepare.test.ts tests/api/capture-transport.test.ts
```

The owned loopback HTTP/Mongo fixtures use only synthetic data. Their explicit
204 probe observes downstream delivery; it is not 201/captured:true and inserts
no event. A rejection must never call that probe with a partial body. The normal
startup remains unchanged; no fake storage response is installed.

## Accepted wire representation

| Property | Policy |
|---|---|
| Media | application/json, application subtypes ending +json, application/x-www-form-urlencoded, or text/* |
| Charset | Absent, utf-8 or utf8, case-insensitive; quoted charset parameters use Node MIMEType |
| Content-Encoding | Absent or a single identity value (case/outer whitespace normalized) |
| Wire bytes | Strict UTF-8; TAB, LF and CR permitted; other C0 controls, DEL and C1 controls rejected |
| Size | At most 256 × 1024 = 262144 raw identity bytes, including GET/HEAD bodies |
| Missing Content-Type | Allowed only when framing proves an empty body: no Transfer-Encoding and declared length zero/absent |
| Duplicate fields | Multiple Content-Type or Content-Encoding fields rejected, even if identical |

Content-Type is capped at 512 characters and parsed with the shared Node MIMEType
normalizer; parser and router reuse one media/charset/encoding selection. Node's
MIME parameter parsing semantics apply, including its treatment of malformed or
repeated parameters. Header-field duplicates are separately rejected using
headersDistinct, since Node's ordinary header map can discard a duplicate type.
An empty body with an explicitly unsupported type/encoding still rejects. Unknown-
length chunked bodies need a supported Content-Type even when they later end empty.

No content sniffing guesses a missing type. Multipart, octet-stream, images, PDF,
XML and other nonselected formats reject. gzip, deflate, Brotli, coding lists and
unknown/empty Content-Encoding reject; no compressed bytes are inflated. A sender
that falsely labels bytes as text must still pass incremental UTF-8/control checks.
This defines the supported text representation, not a universal file/malware
classifier: printable ASCII from another format can still be inert text, and
valid text/JSON/form content may contain secrets or hostile display data.

GET/HEAD have the same byte/media rules. Their bytes are validated incrementally,
counted and discarded, and their handler still receives an empty Buffer for
metadata-only preparation. No complete decoded text is retained. POST/PUT/PATCH/
DELETE retain only bounded original Buffer chunks; validation never replaces them.
Transient decoded chunks exist only to check text validity. UTF-8 sequences split
across chunks are supported, and a truncated final sequence rejects at EOF.
No private byte/header/token/query value or decoder exception is logged/returned.

## Status codes and ordering

| Condition | Result |
|---|---|
| Declared or actual bytes exceed 262144 | PAYLOAD_TOO_LARGE / 413 |
| Unsupported/malformed/missing-required type, charset, coding or duplicate field | UNSUPPORTED_MEDIA_TYPE / 415 |
| Malformed UTF-8 or binary control bytes, including truncated UTF-8 at EOF | UNSUPPORTED_MEDIA_TYPE / 415 |
| Invalid token / disabled inbox / unavailable token storage | Existing 404 / 410 / 503, after valid header preflight |
| Body deadline / broken complete-stream contract | Existing 408 / 400, subject to socket availability |
| OPTIONS | 204 protocol metadata, no collection/lookup/event; media/size validation skipped |
| TRACE / CONNECT | Existing 405; no collection/lookup/tunnel |

For capture requests reaching the router, OPTIONS/unsupported methods are handled
first. Declared length is checked next, then media header preflight, then token
eligibility. Excess declared length therefore takes precedence over media errors;
header failures reject before lookup or 100 Continue. Eligible requests receive
100 Continue only after preflight. Body-dependent failures necessarily happen
after upload permission. Actual byte count is checked before inspecting each
incoming chunk; whichever limit/media violation is first observed rejects it.

413/415 use the existing static error envelope, server-generated request IDs,
no-store and Connection: close. HEAD remains bodyless. 415 also advertises
Accept-Encoding: identity. No untrusted reason/details are added to the shared
catalog. Rejection clears read listeners/timers/chunks and closes the connection;
subsequent valid requests remain usable. Native malformed HTTP framing or broken
sockets can terminate before a JSON response is possible.

## Preparation, storage and release boundaries

Raw accepted data may be passed to [D06.2 preparation](CAPTURE_PARSING.md) by an
explicit downstream handler. Raw bytes remain available for later configured
signature verification before parsing. Malformed JSON or form syntax that is
valid wire text still yields the existing private parse-failure flag; HTTP media
validation does not execute or silently repair it. Percent escapes are parser
data, not transport byte decoding. No partial parse fallback is persisted.

All Day 06 individual components are available. D07.2 durable captures and
D07.3 [oversize/no-partial-storage checks](CAPTURE_REGRESSION.md) demonstrate
Day 06 acceptance. The capture/inspect journey and release remain pending; no
release/milestone issue is closed. D08.1 is the next task.

## Evidence and references

Seven new unit checks cover shared selection, early header errors, empty framing,
duplicates, split/truncated UTF-8, control bytes, collector cleanup and byte-limit
precedence. Five new real-HTTP/Mongo checks cover the rejection/acceptance matrix,
actual gzip/deflate/Brotli bytes, duplicate fields hidden by Node, all methods,
100-continue, exact/chunked limits, recovery, private errors/logs and zero events.
Earlier HTTP positive probes now use explicit supported text rather than arbitrary
binary vectors; arbitrary byte preservation remains covered at the collector
unit boundary and binary HTTP delivery is explicitly denied. No check is weakened.

Primary references: [HTTP 413](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.14),
[HTTP 415](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.16),
[Node headersDistinct](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#messageheadersdistinct)
and [WHATWG TextDecoder](https://encoding.spec.whatwg.org/#interface-textdecoder).
The exact media/control/empty-body limits above are project decisions verified
on pinned Node 24.22.0; online Node 24 docs currently describe 24.22.2.

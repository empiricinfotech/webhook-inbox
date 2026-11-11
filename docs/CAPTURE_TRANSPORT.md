# Explicit capture methods and bounded original bytes

D06.1 | 3 November 2026

The separate Express backend now provides an optional capture router and a bounded
original-byte collector. A caller must supply the existing token-eligibility
service and an explicit downstream handler. Ordinary API and local-dashboard
startup do not mount this router. D06.2 adds [private preparation](CAPTURE_PARSING.md)
for explicit composition; D06.3 adds [HTTP media rejection](CAPTURE_MEDIA.md).
Redaction and durable storage are still later tasks. No default handler returns a fake capture success.

## Exercise the boundary

Use pinned Node 24.22.0/npm 11.19.1, the committed lockfile and a native MongoDB 8
binary. The focused checks create their own loopback HTTP/Mongo resources and
synthetic credentials; no operator config, development database or public URL is
needed:

```bash
npm run bootstrap
npm test -- tests/unit/capture-body.test.ts tests/api/capture-transport.test.ts
```

The integration probe observes byte delivery and replies 204 in tests only. It
does not create events, return an event ID or claim successful capture. A product
provider example/cURL journey must wait for the real sanitized persistence path.

## Composition contract

```ts
const capture = createCaptureRouter({
  tokens,                         // existing createCaptureTokenService result
  handle: consumeValidatedCapture,
});
const server = createApiServer(isDatabaseReady, logger, management, capture);
// Bind the server through the normal loopback startup/lifecycle composition.
```

consumeValidatedCapture is a required server-supplied pipeline, not a function
shipped by D06.1. It receives RawCaptureInput plus the Express response and must
complete its response. An omitted handler fails composition; a handler that
returns without ending the response becomes INTERNAL_ERROR. Consumer exceptions
use the existing safe error boundary. Only the later durable-storage path may
return 201 with eventId/captured:true, after storage actually succeeds.

RawCaptureInput contains method, safe internal inbox target, unnormalized raw
headers, server-generated receivedAt Date, rawBody Buffer and receivedBytes. Headers and raw bytes are untrusted,
private, ephemeral input: never log, persist, export or queue them before the
later sanitization policy. No original URL/capture token is added to the input.
The raw router has no parser; D06.2 preparation can be explicitly composed.
There is no raw vault, forwarding, signature verification or event model.

## Methods and raw-byte behavior

| Request | Behavior |
|---|---|
| GET, HEAD | Validate token/limits, count and discard request body bytes; call the handler with an empty Buffer for metadata-only processing. HEAD responses remain bodyless. |
| POST, PUT, PATCH, DELETE | Validate token/limits; deliver the complete original Buffer to the handler exactly once. Transient UTF-8 validation; no transformation or decompression. |
| OPTIONS | 204, no-store and Allow listing the six methods plus OPTIONS; no token lookup, body retention or handler call. No CORS origin/credentials grant is added. |
| TRACE | METHOD_NOT_ALLOWED/405 with Allow, before token lookup or collection. |
| CONNECT | Rejected by the Node server event with the same 405 catalog/error-ID/no-store contract; no tunnel, lookup or handler. |

The route is case-sensitive, has no trailing-slash alias and matches only
/capture/:token, outside /api/v1. Next's development rewrite remains unchanged;
provider capture bytes must reach Express directly. No global body parser is
installed. Existing local management Host/Origin checks remain in force.

MAX_CAPTURE_BYTES is **256 × 1024 bytes (262144)**. The collector rejects an
excessive declared Content-Length before token lookup or 100 Continue. It also
counts actual incoming Buffer lengths for all six methods, including unknown-
length/chunked uploads. Exactly the limit is accepted at this boundary; the first
byte over it rejects with PAYLOAD_TOO_LARGE/413 and never invokes the handler.
D06.3 also validates supported headers and incremental UTF-8/control bytes before
downstream delivery, returning UNSUPPORTED_MEDIA_TYPE/415 on policy failure.
GET/HEAD count toward this bound even though their content is not retained.
An ended stream must be complete and match any declared length. Already-decoded,
consumed, broken or incomplete streams fail closed; no partial Buffer is delivered.
Retained chunks are released on failure/end. Concatenation can briefly retain
both chunks and the completed Buffer; this is bounded memory, not a claim of
constant memory or measured concurrency capacity.

The body deadline defaults to **10 seconds from collection start**, not an idle
timer reset by each chunk. Trusted composition may choose an integer 1–30000 ms;
it is not request/query/header-controlled. This is an initial operating decision,
not a measured service guarantee. Eligibility/database time is separate and uses
the existing bounded connection behavior. Expiry produces REQUEST_TIMEOUT/408.
Timers and active collection listeners are removed on success/failure; disconnects
cannot invoke the handler with partial data. A rejected upload closes its HTTP
connection rather than preserving it for reuse. Broken sockets or malformed HTTP
framing handled by Node can close before a JSON response is possible.

The Node server handles checkContinue explicitly: an eligible in-bound capture
receives 100 Continue after preflight, while an excessive/missing/disabled target
can be rejected before permitting its upload. Non-capture requests retain Node's
normal continue behavior. CONNECT uses its dedicated Node event, with a bounded
socket cleanup timer, shared static error envelope and no private request logging.
No undocumented ServerResponse/socket-attachment API is used.

## Errors, security and remaining scope

| Failure | Code/status |
|---|---|
| Invalid input/encoding of route or incomplete/decoded stream | INVALID_REQUEST/400 |
| Unsupported method | METHOD_NOT_ALLOWED/405 |
| Collection deadline | REQUEST_TIMEOUT/408 |
| Invalid/old/missing token or inactive workspace | NOT_FOUND/404 |
| Current disabled inbox | ENDPOINT_DISABLED/410 |
| Declared/streamed byte limit | PAYLOAD_TOO_LARGE/413 |
| Unsupported media/coding, duplicates or nontext wire bytes | UNSUPPORTED_MEDIA_TYPE/415 |
| Token storage unavailable | STORAGE_UNAVAILABLE/503 |
| Unexpected consumer error or missing response | INTERNAL_ERROR/500 |

Errors use static messages, no-store and server-generated request IDs; no input,
stream/driver causes, tokens, raw URLs, headers or bytes are logged. The normal
request logger records route templates; CONNECT records only an unmatched method
and safe response metadata. Token rotation and disabled-state semantics reuse
the [existing eligibility guard](INBOX_MANAGEMENT.md). Eligibility is checked
before collection; rotation/disable does not cancel a read already authorized
under the documented in-flight policy. No final-generation reservation is added.

D06.2 provides [private JSON/form/text preparation](CAPTURE_PARSING.md), and D06.3
now enforces the [media/coding/text-byte policy](CAPTURE_MEDIA.md). HTTP probes
use supported text; arbitrary original bytes remain tested at the lower collector
unit boundary and do not imply supported binary product captures. D07.1
[redaction](CAPTURE_REDACTION.md) is implemented separately; D07.2 owns sanitized
persistence before acknowledgement. No first capture, public hosting,
release, quotas, load result or complete Day 06 acceptance is claimed.

## Verification

Five stream/composition unit checks and seven real-Mongo/Node HTTP tests cover
split original bytes, exact limits and overflow, metadata-only methods, lifecycle
cleanup, incomplete/error/deadline rejection, explicit composition, all methods,
OPTIONS/TRACE/CONNECT, eligibility/storage errors, route matching, safe consumer
failure, interrupted upload recovery and 100-continue ordering. The ordinary
management POST continue flow is exercised with its existing guards/parser.
Existing error-catalog tests automatically cover the new 405/408 codes; normal
npm test/CI discovers these additions without new dependencies or runners.

Primary references: [Node HTTP checkContinue](https://nodejs.org/docs/latest-v24.x/api/http.html#event-checkcontinue),
[CONNECT](https://nodejs.org/docs/latest-v24.x/api/http.html#event-connect_1),
[message.complete](https://nodejs.org/docs/latest-v24.x/api/http.html#messagecomplete)
and [Express 5 router](https://expressjs.com/en/5x/api/router/).
Online Node docs describe 24.22.2; behavior is verified with the pinned Node
24.22.0 runtime/types and real loopback transports, without a runtime upgrade.

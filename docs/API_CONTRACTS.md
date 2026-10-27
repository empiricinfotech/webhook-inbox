# Shared API contracts and request correlation

D03.1 | 26 October 2026

Express owns these boundaries. The browser-compatible private contracts package
exports runtime Zod schemas and inferred types without MongoDB, Express or Node
imports. No domain route, database model or authentication feature is added here.

## Identifiers

Import `identifierSchema` and `requestIdSchema` from
`@empiric-webhook-inbox/contracts/identifiers`.

- Database identifiers are exactly 24 hexadecimal characters, normalized to
  lowercase strings. Numbers, database objects, 12-character strings, whitespace,
  arrays and query operators are rejected. ObjectId allocation/storage remains
  in the API; shared schemas do not import Mongoose.
- IDs identify objects; they never grant access. Workspace authorization must
  still be enforced by later domain routes.
- Request IDs are UUID v4 values, distinct from database identifiers. Express
  generates a fresh ID for each request reaching its middleware, including health,
  missing routes and HEAD. The exported header name is `REQUEST_ID_HEADER`.

## Errors and health responses

Import `apiErrorResponseSchema`, `apiErrorCodeSchema`, `API_ERRORS`,
`createErrorResponse` and their types from the `/errors` export. Errors have one
strict envelope with no stack, cause, input, field values or driver diagnostics:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "requestId": "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5"
  }
}
```

The ID above is synthetic. For a real response, `X-Request-Id` must equal
`error.requestId`. `createErrorResponse` selects a static public message; callers
must not substitute untrusted exception text. The response schema accepts only
known codes, a nonempty message up to 200 characters and a valid UUID v4, and
rejects unknown properties at both envelope levels.

| Code | HTTP status |
|---|---|
| INVALID_REQUEST | 400 |
| UNAUTHENTICATED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND | 404 |
| CONFLICT | 409 |
| ENDPOINT_DISABLED | 410 |
| PAYLOAD_TOO_LARGE | 413 |
| UNSUPPORTED_MEDIA_TYPE | 415 |
| RATE_LIMITED | 429 |
| STORAGE_UNAVAILABLE | 503 |
| INTERNAL_ERROR | 500 |

The Express `ApiError` accepts a catalog code. Shared-schema Zod validation
errors map to INVALID_REQUEST without returning validation diagnostics. Other
thrown values, arbitrary status/header properties and rejected async handlers
produce INTERNAL_ERROR with a generic message; raw errors are not serialized
or logged. After response headers have been sent, Express terminates via its
default handler using a replacement generic error, never the original exception.
Error responses use Cache-Control: no-store. HEAD keeps status/headers with no body.

A missing management route currently returns NOT_FOUND; it is not evidence of
implemented inbox behavior. Capture remains unimplemented and returns the same
safe missing-route envelope. Existing health response bodies remain special
operational snapshots: `{ "data": { "status": "live" | "ready" | "not_ready" } }`.
Readiness 503 is not a domain error and does not change shape.

## Pagination transport

Import `paginationQuerySchema`, `cursorSchema`, `pageResponseSchema` and the
`PaginationQuery`, `Cursor`, `Page<T>` types from `/pagination`.

```ts
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { paginationQuerySchema, pageResponseSchema } from "@empiric-webhook-inbox/contracts/pagination";
import { z } from "zod";

paginationQuerySchema.parse({ limit: "25" }); // { limit: 25 }
const page = pageResponseSchema(z.strictObject({ id: identifierSchema }));
page.parse({ data: [], nextCursor: null });
```

Only `limit` and optional `cursor` are accepted by the base list-query schema.
Missing limit defaults to 25; an explicitly supplied limit must be a decimal
string from 1 to 100 without signs, leading zeros, whitespace or exponent syntax.
Numbers, arrays, objects, unknown keys and Mongo operators are rejected rather
than coerced. Later endpoints can explicitly extend the schema with supported
filters; they must not forward raw query objects to Mongo.

Cursor transport is an opaque, case-sensitive, nonempty token of at most 512
ASCII URL-safe characters (`A-Z`, `a-z`, `0-9`, `_`, `-`). Clients pass it back
unchanged. This validates the transport shape only: it does not decode or trust
a database position. Versioned cursor encoding, receivedAt/ID ordering, query
scope and stable traversal are D08.2 work. No pagination endpoint exists yet.

A page has a `data` array of validated items (maximum 100) and a required
`nextCursor` token or null when finished, including empty pages. No total count,
page-number offset, raw Mongo selector or additional envelope fields are exposed.
The eventual service must also enforce the requested limit and access scope.

## Request context and safe logs

Express middleware uses Node AsyncLocalStorage to retain the server-generated
ID across promises and async handlers. API code can call `getRequestId()` inside
a request; outside the context it throws rather than inventing an ID. Incoming
X-Request-Id values are ignored even if valid, preventing spoofed correlation or
private input from being echoed. IDs are correlation data, never credentials or
idempotency keys. No distributed tracing/trusted-proxy ID policy is implied.

The real API startup passes its Pino logger through to the app. Completed
responses log only requestId, an allowlisted method (OTHER for unknown methods),
the registered route template or `unmatched`, status and durationMs. The ID is
captured for the finish callback. Route parameters, original URL, queries,
headers, bodies and exception objects are excluded. Unknown failures also log a
fixed error code with the same ID. No workspace identifier is logged until a
future authorization layer can supply a verified one. Aborted connections before
finish and startup failures are outside completed-response logging.

## Verification and pending work

`npm run check:contracts` builds shared JS first and runs the six original
contract regressions under Vitest (four unit and two HTTP tests):
identifier/query/page/error boundaries, real application success/404/HEAD,
expected statuses, validation/unknown async errors, twenty overlapping requests,
context cleanup, header spoofing, log redaction and sanitized late-error delegation.
Existing foundation and source/compiled Mongo suites verify health regression
and the real API's new missing-route envelope. D03.2 adds the planned Vitest/Supertest dependencies; see
[testing](TESTING.md) and [progress](IMPLEMENTATION_PROGRESS.md) for checks/results.

No frontend UI changes are needed. D03.2 now provides the disposable-data
unit/API harness; D03.3 adds CI. The Day 03 deliberate-failure-in-CI acceptance
remains pending until that automation exists.

References consulted: [Zod schemas](https://zod.dev/api),
[Express error handling](https://expressjs.com/en/guide/error-handling/), and
[Node asynchronous context](https://nodejs.org/api/async_context.html).

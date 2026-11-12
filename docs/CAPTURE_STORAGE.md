# Local durable capture

D07.2 | 12 November 2026

The opt-in `npm run local:dashboard` now mounts a workspace-scoped Express
`/capture/:token` receiver. After the existing token, media, byte and deadline
checks, it sanitizes the request, writes a validated event to MongoDB and returns
201 with `{data:{eventId,captured:true}}` only after MongoDB acknowledges the
journaled majority write. HEAD also stores metadata and returns 201 without a
response body. GET stores metadata, and OPTIONS remains event-free. Every accepted
delivery creates a separate event. No message is forwarded.

`dev:api`/`start:api` remain health-only. The local receiver binds loopback,
accepts only the configured workspace's capture tokens, and must not be exposed
through a public proxy or tunnel. The current UI/CLI does not reveal capture URLs;
owner-only token retrieval exists internally. Event listing, inspection, deletion
and a complete self-service capture journey are later tasks.

## Configure the local receiver

Use [local inbox setup](LOCAL_INBOX.md), pinned tools and MongoDB, then start the
existing `local:dashboard` command. The server reads these optional trusted
process/private-configuration settings when it starts:

| Setting | Default | Behavior |
|---|---|---|
| `LOCAL_CAPTURE_BODY` | `true` | Set `false` to omit every non-metadata body for this local workspace. Only literal `true` or `false` is accepted. |
| `LOCAL_SENSITIVE_JSON_KEYS` | `[]` | JSON array of up to 64 literal sensitive JSON property names; extends the built-in defaults. Example synthetic names: `["private_field","partner_key"]`. |

The policy applies to all inboxes in this single local workspace, not separately
editable inbox settings. Untrusted request headers, query strings and bodies cannot
change it. Restart the API after changing configuration. Invalid policy fails
startup with field names only. No configuration value or capture credential is
logged. [Redaction rules and limits](CAPTURE_REDACTION.md) describe exact matching,
normalization, body omission and which secrets cannot be discovered automatically.
Keep real payloads/credentials out of examples, logs and the public repository.

## Storage contract

A strict server-only Zod allowlist validates each event before insertion. The
record contains an ObjectId, workspace/inbox ObjectIds, server-arrival time,
expiry, method, received byte count, normalized content type, the Content-Type-only
header projection, body format/value, parse flags/reason, redaction flags/count,
and `signatureState: "unverified"`. No original buffer, request URL/query, token,
credential header, forwarding header, provider signature or driver error is stored.

The inbox's resolved retention setting (1, 7 or 30 days) is added to the original
arrival timestamp in UTC. Eligibility and retention are the snapshot resolved
before body collection; disable/rotation during an already authorized upload does
not cancel it. Foreign workspace tokens return 404 before their disabled state is
revealed. Current disabled inboxes return 410 and invalid/rotated tokens return
404. Normal token and storage errors remain static, correlated and no-store.

Sanitized JSON and URL-encoded form pairs are serialized as JSON **strings** in
`safeBody`; text is stored as text. This preserves literal keys including `.` and
`$`, NUL and `__proto__` as data rather than MongoDB field names. Consumers must
interpret the string according to `format`, parse it as inert JSON when appropriate,
and render every value safely. Metadata-only, omitted and unparsed bodies store
null. A malformed JSON/form body stores the existing static parse failure flag and
no partial content, then can receive 201 if that event was stored. An intentionally
omitted body reports `parseFailed:false` as a policy result, not proof that omitted
input was valid.

The insert requests majority acknowledgment and journal sync with a 10-second
driver deadline. A database/acknowledgment error returns 503 rather than capture
success. A timeout or lost connection can have an **uncertain outcome**: a write
may already have committed. Check records when inspection becomes available before
manually retrying; a repeat is a new delivery, not automatically deduplicated.
MongoDB documents both the [journal acknowledgment](https://www.mongodb.com/docs/manual/reference/write-concern/#acknowledgment-behavior)
and [ambiguous write-concern timeouts](https://www.mongodb.com/docs/manual/reference/write-concern/#wtimeout).

`expiresAt` is attached now; TTL indexes, cleanup and enforcement on reads belong
to D18. Until then, stored records do not automatically disappear at expiry.
This task adds no event read route or list index. Capture has no quota/rate limiter,
authenticated sessions, signature verification, worker, replay or release.
Only configured JSON keys are removed; arbitrary text/form content and unconfigured
or string-embedded secrets may remain. Use synthetic data, or disable body capture.

## Verification and next task

```bash
npm test -- tests/unit/local-capture-policy.test.ts tests/api/capture-persistence.test.ts
```

The tests use owned disposable Mongo databases/listeners and synthetic inputs. They
check persisted schema, redaction and unusual keys, expiry, parse flags/formats,
GET/HEAD/OPTIONS, duplicate delivery IDs, workspace/token isolation, actual
acknowledgment ordering, error/recovery and ambiguous-write behavior, policy
validation, body omission, and an actual local-dashboard process using configured
redaction. No normal development data or configuration file is modified.

D07.3 adds [real database-outage, hostile text and nested stored-fixture
regressions](CAPTURE_REGRESSION.md), demonstrating Day 07 acceptance. D08.1 is
next; the v0.1 capture-inspect-delete release gate remains pending.

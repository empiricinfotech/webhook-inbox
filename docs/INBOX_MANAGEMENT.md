# Inbox rename, disable and token rotation services

D05.2–D05.3 | Updated 3 November 2026

An owner can rename or disable an inbox and replace its capture credential
through the existing Express backend services. These are internal methods for
trusted server composition. The [local UI/API](INBOX_UI.md) and [operator command](LOCAL_INBOX.md)
still expose their existing create/list/detail capabilities. No new HTTP route,
UI control, capture endpoint, public signup or session/membership flow is added.

## Contracts and calling example

Initialize the [connection-owned models and indexes](DATA_MODELS.md) through
`await createInboxService(connection, crypto)` before using credential methods.
The supplied crypto must use an operator-managed key; preserve private operator
configuration. All IDs below are native Mongoose ObjectIds from trusted server
composition, not caller-controlled strings, headers or Mongo query objects.

```ts
const inboxes = await createInboxService(connection, crypto);
const tokens = createCaptureTokenService(connection, crypto);
const owner = { actorId: trustedActorId, workspaceId: trustedWorkspaceId };
const renamed = await inboxes.renameForOwner(owner, trustedInboxId, {
  name: "Synthetic staging integration",
});
const disabled = await inboxes.disableForOwner(owner, trustedInboxId);
await tokens.rotateForOwner({ ...owner, inboxId: trustedInboxId });
// Renamed/disabled results contain only safe InboxSummary metadata.
// Rotation returns void. Retrieve separately only for an explicit owner action:
const captureToken = await tokens.retrieveForOwner({ ...owner, inboxId: trustedInboxId });
// Never log/print captureToken, key material or tokenized URLs.
```

| Operation | Observable result |
|---|---|
| renameForOwner(owner, inboxId, input) | Strict shared renameInboxSchema accepts only name: trim, 1–100 UTF-16 code units, no ASCII controls/DEL. Returns current InboxSummary; changes only name and updatedAt. Duplicate names remain allowed. |
| disableForOwner(owner, inboxId) | Sets enabled:false; preserves the inbox, credentials and all other settings. Repeated disable returns the same metadata without changing timestamps. No enable or delete operation is implied. |
| rotateForOwner({ actorId, workspaceId, inboxId }) | Creates a new random 256-bit token with authenticated encrypted storage, atomically replaces the pair, updates updatedAt and returns void. The old token no longer resolves; owner retrieval recovers the current token. |

Every mutation rechecks the active workspace's current stored owner and scopes the
inbox query by both ID and workspace. Missing/nonowned/mismatched objects share
NOT_FOUND. Native-ID validation rejects scalar/operator coercion. Rename's strict
input rejects attempts to change scope, enabled, retention, timestamps or secrets.
Rename/disable return the existing explicit DTO allowlist: id, workspaceId, name,
description, enabled, retentionDays, createdAt and updatedAt. No token, token hash,
encrypted envelope, key or capture URL enters an ordinary response.

## Rotation and failure boundaries

Generation/encryption completes before the write. One validated single-document
update replaces tokenHash and encryptedToken together, matching the previously
read hash as a compare-and-set condition. The unique partial hash index prevents
credentials from colliding with another inbox. A candidate equal to the current
hash is rejected. Two rotations that read the same generation have one winner;
the loser gets CONFLICT. Calls that read a later generation may rotate again.
There is no idempotency key or automatic retry.

Crypto failure, rejected validation, duplicate hash or a failed compare-and-set
cannot partially replace the pair. A storage error uses a safe static error,
but a lost acknowledgement can mean a complete update already happened. Inspect
the current owner-authorized state before retrying an uncertain rotation; do not
assume the old token survived every network/storage error. A completed rotation
does not cancel a request that already resolved the old token before the update.

Rotation uses the configured current encryption key and does not decrypt the old
envelope. An authorized operator can explicitly replace a credential even when
its old key is unavailable; this does not migrate other inboxes or recover an old
key. Legacy metadata-only records return CONFLICT: use the existing explicit
one-time provisioning method instead. Missing/inaccessible inboxes return NOT_FOUND.

| Failure | Static service code |
|---|---|
| Invalid ID or rename input / rejected update validation | INVALID_REQUEST |
| Missing, inaccessible or inactive scope | NOT_FOUND |
| Generation conflict, duplicate hash or unprovisioned rotation | CONFLICT |
| Crypto failure | INTERNAL_ERROR |
| Unavailable database or other driver failure | STORAGE_UNAVAILABLE |

Errors retain no private cause or input. Narrow updates preserve settings under
concurrent rename/disable/rotation; none of these methods re-enables an inbox.
A disabled inbox still resolves its current token to enabled:false. D05.3 adds
requireEnabledForCapture(unknown): it reuses sanitized lookup, throws NOT_FOUND
for malformed/unknown/old tokens or missing/inactive workspaces and throws
ENDPOINT_DISABLED unless the stored enabled flag is exactly true. A valid enabled
token returns only inboxId, workspaceId, enabled and retentionDays. Storage
failures retain STORAGE_UNAVAILABLE. Syntax rejection occurs before database
access. The guard does not decrypt/reveal a credential or require a management
actor: the capture token is its bearer credential, separate from owner methods.
It neither accepts bytes nor persists/acknowledges an event.

The shared Express error handler already maps these codes to 404/410/503. D05.3
verifies that real guard/handler composition with a test-only HTTP adapter;
there is still no installed capture receiver. Ownership checks and writes remain separate;
later owner-transfer/deletion workflows need their own concurrency policy.
No session authentication, membership revocation or audit trail is claimed.

## Verification and next task

The normal Vitest suite discovers strict rename unit checks and real disposable
Mongo service checks in tests/api/inbox-management.test.ts. They verify success,
repeat disable, preserved settings/secrets, invalid input, cross-workspace and
changed-owner denial, deleting workspaces, old-token invalidation, disabled state,
unique collision, crypto/validation/write failures, recovery, deterministic
concurrent rotation, legacy records, unavailable storage and current-key replacement.
Secret comparisons use booleans so assertion diffs do not print credentials.
Normal developer databases, configuration and running services are untouched.

D05.3 adds five focused tests in tests/api/inbox-management-responses.test.ts:

- Real local POST validation rejects malformed shapes, control characters,
  privileged fields and over-limit strings with safe correlated 400 errors; a
  normalized 100-UTF-16-unit Unicode name/500-unit description is accepted.
- Invalid rename and rejected driver writes preserve the saved metadata and
  credential pair; subsequent rename/disable succeeds and HTTP reads remain safe.
- Local detail/list/HEAD responses stay secret-free and show enabled:false after
  rename/disable/rotation and fresh router composition. A disabled inbox remains
  manageable (200 with disabled metadata); capture eligibility is a separate rule.
- Multiple old token generations fail across fresh connections while the current
  token and an unrelated inbox remain valid.
- The production eligibility guard plus real shared response handler return
  404 for missing/malformed/old tokens, 410 for a current disabled inbox and 503
  for unavailable storage, with no-store, fresh request IDs and no secret logs.
  Inactive workspaces return 404; malformed input rejects even during an outage.

The HTTP eligibility adapter exists only in tests and contains no duplicated
policy decisions. Its 200 response exposes target metadata to the test, not a
product capture acknowledgement; an events count check confirms no capture was
stored. These tests do not claim a product /capture endpoint exists.

Day 05's create/disable/old-token acceptance is demonstrated through the existing
services, local metadata HTTP and shared error response contract. D05.3 is complete
at those implemented boundaries. D06.1 now adds an [optional method/byte router](CAPTURE_TRANSPORT.md)
using the eligibility guard; normal startup still has no capture-to-store handler.
D06.2 safe metadata/parsing is next, followed by the remaining D06–D07 pipeline.
No Day 06, first successful capture or release gate is marked complete.

Primary references: [Mongoose atomic updates](https://mongoosejs.com/docs/tutorials/findoneandupdate.html#atomic-updates),
[update validation](https://mongoosejs.com/docs/validation.html#update-validators)
and [Node crypto](https://nodejs.org/docs/v24.22.0/api/crypto.html).
Online Mongoose docs currently describe 9.11.4; implementation is verified against
the repository's pinned Mongoose 9.11.2 and MongoDB 8.0.32, without upgrades.

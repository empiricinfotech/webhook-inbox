# Inbox rename, disable and token rotation services

D05.2 | 2 November 2026

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
A disabled inbox still resolves its current token to enabled:false so the future
capture transport can apply ENDPOINT_DISABLED/410. It does not accept a capture
or emit that HTTP response today. Ownership checks and writes remain separate;
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

These are D05.2's necessary implementation checks. D05.3 remains a separate
validation/old-token/disabled-response verification task; it is not marked done.
The Day 05 create/disable/old-token expectations are demonstrated at the service
boundary. A real capture HTTP 410 belongs to the later capture transport and is
not required to implement these services. No release gate is claimed complete.

Primary references: [Mongoose atomic updates](https://mongoosejs.com/docs/tutorials/findoneandupdate.html#atomic-updates),
[update validation](https://mongoosejs.com/docs/validation.html#update-validators)
and [Node crypto](https://nodejs.org/docs/v24.22.0/api/crypto.html).
Online Mongoose docs currently describe 9.11.4; implementation is verified against
the repository's pinned Mongoose 9.11.2 and MongoDB 8.0.32, without upgrades.

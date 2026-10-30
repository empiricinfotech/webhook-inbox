# Capture token primitives and owner retrieval

D04.2–D04.3 | 30 October 2026

The backend now provisions credentials for an existing inbox metadata record,
looks up an inbox by a capture token's hash and recovers the token only after a
stored-owner check. [D04.3](LOCAL_INBOX.md) composes these primitives for local
bootstrap and atomic inbox creation. No capture/management route, login or token
rotation is added. The existing health-only startup stays unchanged.

## Token and encrypted format

- Generation uses Node crypto.randomBytes(32): 256 random bits, encoded as a
  canonical 43-character base64url string without padding.
- Lookup validates the exact canonical encoding, then hashes the ASCII token
  with SHA-256. Only the 64-character lowercase hex hash is used in Mongo filters.
  No caller-supplied query object/string is interpolated into a Mongo operator.
- Encryption uses Node AES-256-GCM, an operator-provided 32-byte key, a fresh
  random 12-byte nonce and a 16-byte authentication tag. It never uses a password,
  hardcoded/default key, reused fixed nonce or unauthenticated encryption.
- encryptedToken is a strict nested object: formatVersion (1), keyVersion
  (1–32 ASCII letters/digits/dot/underscore/hyphen, starting with a letter/digit),
  nonce (24 hex characters), ciphertext (86 hex characters) and tag (32 hex
  characters). There is no plaintext token or encryption key field in Mongo.
- Authenticated additional data is a JSON array containing the fixed purpose,
  format version, key version, canonical workspace ID and inbox ID. A copied
  envelope cannot be decrypted for another inbox/workspace, including when its
  hash is copied with it. Changing an available key-version alias also fails.
- Decryption authenticates before using plaintext, validates its token encoding
  and compares its hash against the stored hash with timingSafeEqual. Bad format,
  context, ciphertext, tag, digest or key produces a static error without a cause.

Hashing is appropriate here because the tokens are high-entropy random bearer
values. This is not password storage or a password-hashing recommendation.
The 100-token test is a format/duplicate regression check, not a measured entropy
or cryptographic strength claim. Secrets must never be logged or used as metrics.

## Operator key boundary

createCaptureTokenCrypto accepts currentVersion plus an actual Map of version to
Uint8Array/Buffer key bytes. Each value must be exactly 32 bytes. The current
version must exist and all version labels are validated. Key bytes are copied
into private Node KeyObjects; subsequent caller buffer mutations cannot change
the imported keys. The returned API exposes no key material and performs no I/O.

Keys must come from operator-managed runtime secrets outside Mongo/source, with
separate secure backups. The crypto factory does not read environment files or persist keys. D04.3
supplies one explicitly provisioned key from private local operator configuration;
there is no automatic generation fallback on bootstrap/create or server startup.
Missing/bad configuration fails closed.
Tests create their own ephemeral random keys, which are not production defaults.

New envelopes use currentVersion. Retaining old versions permits recovery of old
envelopes; dropping/wrongly replacing an old key fails closed until the correct
key is restored. Hash lookup does not need decryption and remains independent
of encryption-key availability. Automatic key migration/re-encryption and capture
token rotation are not implemented. This versioned read/write capability does
not claim an operator rotation or backup drill has occurred.

## Internal service contract

createCaptureTokenService(connection, crypto) uses caller-owned Mongoose models.
The caller must initialize declared indexes explicitly before normal use.

| Method | Result and boundaries |
|---|---|
| issueForInbox({ actorId, workspaceId, inboxId }) | Checks the active workspace's stored owner and an existing scoped inbox; atomically sets the credential pair only if both are absent; returns no token |
| retrieveForOwner({ actorId, workspaceId, inboxId }) | Checks the current stored owner, selects credentials only internally and returns the authenticated plaintext token |
| findByCaptureToken(unknown) | Malformed/unknown token or deleting/missing workspace returns null; a match returns only inboxId, workspaceId, enabled and retentionDays |

All request IDs must be native ObjectIds, not strings/operator objects. Owner,
workspace and inbox lookups are scoped; missing, nonowned and mismatched objects
share NOT_FOUND. A metadata-only inbox also has no retrievable credential.
Issue uses one compare-and-set update for both fields; concurrent/repeated issue
attempts produce one success and CONFLICT, without replacing an existing token.
The service only provisions existing records; D04.3 separately creates credentialed inboxes in a single insert.

The actor ID must come from a trusted local caller now and verified session/
membership context when authentication is introduced. Supplying an ID to this
internal API is not authentication. No request header/body becomes a trusted
actor here, and no HTTP endpoint exposes the service. This owner predicate does
not complete the later session, membership/role or revocation tasks.

A disabled inbox remains discoverable with enabled:false so the later capture
handler can return its documented 410. Lookup does not acknowledge capture,
persist events or decide HTTP status. Corrupted/undecryptable storage maps to
INTERNAL_ERROR; driver failures map to STORAGE_UNAVAILABLE. Service errors use
existing static ApiError messages and never retain a private crypto/driver cause.

## Storage and ordinary reads

The inbox schema adds tokenHash and encryptedToken with default select:false.
Default hydrated/lean queries omit them. toJSON/toObject transforms also remove
both from fresh or explicitly selected documents. The lookup method constructs
an explicit metadata result; only owner retrieval intentionally returns a token.
The existing request logger already omits raw URLs, parameters, query and headers;
its capture-path redaction regressions continue to run unchanged.

A real unique partial index on tokenHash applies to string hashes, preserving
multiple older metadata-only inboxes. Document validation permits neither field
for D04.1 compatibility but rejects a partial pair, nulls or malformed envelopes.
The token service always sets a validated pair together. D04.3 creation inserts the validated pair atomically before reporting success.

Selecting hidden fields, lean results with explicit secret projections, raw driver
access, transform:false or bypass writes remain trusted backend operations;
select/serialization defaults are defense in depth, not authorization. Direct
model updates must not unset/replace one credential field or bypass validation.
Future transport/service input must use explicit allowlists. No migration touches
normal development data in this task; tests use owned disposable databases only.

## Calling example

The inputs below are provided by trusted server composition, not HTTP input.
Never print captureToken, serialize crypto/credentials, or put them into logs.

```ts
const crypto = createCaptureTokenCrypto({
  currentVersion: "operator-key-v1", keys: operatorManagedKeys,
});
const tokens = createCaptureTokenService(connection, crypto);
await tokens.issueForInbox(verifiedActorAndInbox);
const captureToken = await tokens.retrieveForOwner(verifiedActorAndInbox);
// Only an explicit owner-authorized response may receive captureToken.
```

## Verification and remaining scope

npm test automatically includes new unit and real-Mongo API checks. They cover
canonical token generation, fresh nonces, tampering/context/hash/key-version
binding, missing/wrong/old keys, key-copy semantics, paired storage validation,
ordinary serialization, actual unique indexes and hash lookup, owner/scoping
and changed-owner denial, one-time concurrent issue and safe database failures.
Tests compare secrets as booleans so assertion diagnostics do not print them;
there are no committed keys or raw token fixtures. See [testing](TESTING.md).

D04.3 adds local bootstrap/creation and explicit environment composition. Capture
endpoints, HTTP token retrieval, rotation, membership/session authorization and
release journeys remain later work. Day 04's created-inbox/list acceptance is now
verified through services and the operator command, not a shipped HTTP endpoint.

Primary references: [Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html),
[OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).
Behavior is verified on the pinned Node 24.22.0, Mongoose 9.11.2 and MongoDB 8.0.32.

# Local workspace bootstrap and inbox creation

D04.3 | 30 October 2026

A local operator can now create a workspace, create credentialed inboxes and list
safe metadata using the Express backend's services. This is a command-line flow,
not a dashboard, HTTP management API, user account or public signup flow.
The Next.js shell and health-only Express server are unchanged.

## Try the local flow

Use the pinned Node/npm pair and run npm run bootstrap first. Start the
[loopback Mongo service](MONGODB_LOCAL.md) (native MongoDB 8 or the existing Compose
service), then run from the repository root:

```bash
npm run local:inbox -- init
npm run local:inbox -- bootstrap
npm run local:inbox -- list
npm run local:inbox -- create "Synthetic integration" "Local synthetic webhook testing"
npm run local:inbox -- list
```

Each command builds contracts and the API, then runs emitted JavaScript with
plain Node. init explicitly creates apps/api/.env.inbox.local with a fresh random
32-byte encryption key, stable random owner/workspace ObjectIds and the loopback
Mongo URI. It creates the file exclusively with POSIX mode 0600, refuses existing
files/symlinks and never replaces configuration or rotates a key. Its output is
only a status. Use init once; subsequent runs preserve this file and IDs.
Do not copy the empty IDs/key from [.env.inbox.example](../apps/api/.env.inbox.example)
and expect a working configuration. That file documents the required fields.

The operator command loads only apps/api/.env.inbox.local; it never reads or
modifies the server's .env.local or the frontend's configuration. Existing process
variables override the file, following Node's env-file rules. Keep real files
ignored; no key is exposed through NEXT_PUBLIC_, command arguments or output.
Back up the operator file securely, separately from Mongo. Losing/replacing the
key prevents recovery of existing tokens; changing IDs chooses a different
identity/workspace. There is no automatic key recovery, key migration or rotation.
The local command currently composes one key version; the lower-level crypto
factory supports retained versions for later operator tooling.

If the Mongo port/database differs, edit MONGODB_URI in this private file before
bootstrap. The command accepts only literal 127.0.0.1 or [::1], an explicit
non-system database name (letters, numbers, underscore/hyphen), optional port and
optional directConnection=true. Database commands reject production NODE_ENV, SRV, DNS names,
multiple hosts, replica-discovery options, system databases and fragments.
Validation adds directConnection=true when absent; this prevents replica
discovery from reaching another host.
This guard is specific to the operator command; ordinary API Mongo configuration
is unchanged. A trusted local operator still chooses and controls the database.

bootstrap initializes the declared workspace/inbox indexes and creates the
configured workspace if absent. Running it repeatedly or concurrently retains
one workspace and its original name, owner, state and timestamps. A matching
existing active workspace is reused; a different owner or deleting state is a
CONFLICT. Editing LOCAL_WORKSPACE_NAME does not rename an existing workspace.
No user or membership record is created: LOCAL_OWNER_ID is a local placeholder
for trusted service calls until the later identity/membership tasks.

list starts empty. create accepts a name and optional description and creates
one new inbox on every successful invocation; identical names are allowed.
It does not automatically bootstrap missing workspaces. Repeating create after
an uncertain write may create another inbox; creation has no idempotency key.
Do not blindly retry a failed/interrupted create: inspect list first.

Successful commands emit a data object. Creation/list entries contain only:
id, workspaceId, name, description, enabled, retentionDays, createdAt and updatedAt.
IDs are canonical strings and timestamps are UTC ISO 8601 strings. New inboxes
are enabled with seven-day retention metadata. No token, hash, encrypted envelope,
key or capture URL is printed. Capture/HTTP token retrieval are not implemented;
this command cannot yet receive a webhook.
Errors return a static error.code on stderr and exit nonzero, without private
input, environment values, argv, URI, driver messages or causes. Bad configuration
is INVALID_CONFIGURATION; an existing init file is CONFIG_ALREADY_EXISTS.

## Internal backend services

- bootstrapLocalWorkspace(connection, { ownerId, workspaceId, name }) uses the
  configured _id as its idempotency boundary and never overwrites existing data.
- await createInboxService(connection, crypto) creates the declared inbox indexes
  before exposing creation/list methods. Index failure fails initialization.
- createForOwner({ actorId, workspaceId }, input) checks the active workspace's
  stored owner and validates a strict shared createInboxSchema. Only name,
  description and retentionDays (1, 7 or 30; default 7) are accepted. Name and
  description follow the [metadata bounds](DATA_MODELS.md); unknown fields,
  credential/owner/scope/enabled injection and scalar coercion are rejected.
- Creation allocates the inbox ID, generates the [bound encrypted credential](CAPTURE_TOKENS.md)
  and inserts all fields in one document save. Crypto/validation/write failures
  cannot leave a newly inserted metadata-only inbox. A real unique partial hash
  index rejects hash collisions; there is no tokenless fallback or silent rotation.
- listForOwner(request) rechecks the active stored owner, filters by workspace and
  sorts createdAt descending with an _id descending tiebreaker. An explicit
  projection and DTO allowlist exclude credentials even if storage fields grow.

Services require native ObjectIds and a trusted caller-supplied actor, not a
header/body identity. Missing/inaccessible scopes share NOT_FOUND. Validation,
conflict, crypto and storage failures use static ApiErrors without causes.
The database handle exposes its caller-owned connection for this composition;
normal health/startup behavior and pool ownership stay intact. The command closes
its pool on success or handled failure, without listening on an HTTP port.

Indexes use createIndexes, never destructive syncIndexes/drop. Bootstrap and
creation are separate operations: interrupted bootstrap may leave its workspace
created while index initialization still needs a retry. No transaction/replica
set is needed for the single-document inbox insert. Ownership checks and inserts
are separate operations; later transfer/membership/deletion workflows must add
their concurrency policies. Model references do not enforce foreign keys.

## Verification and remaining scope

npm test discovers four contract/config unit tests and nine new real-Mongo/service/
operator-process tests. These cover repeat/concurrent bootstrap, no overwrite,
credential lookup/owner retrieval, explicit secret-free DTOs, real indexes/hash
collisions, validation, scope denial, atomic failure paths, outage handling,
private config creation/no overwrite, actual command execution and safe failures.
Fixtures own disposable Mongo processes/data and private temporary config; they
never read/copy real operator environment files. Runtime secrets are compared
through booleans to avoid secret-bearing assertion diagnostics.

Day 04's created-inbox/secret-free list criterion is exercised through backend
services and the operator command. It does not require Day 05's UI or infer a
shipped HTTP list endpoint. Listing is an internal local array; API pagination
and inbox quotas remain future policy work. No signup, password/session/membership,
rename/disable/rotation, capture route, event storage, frontend, hosted deployment
or release is added. D05.1 is next and has not been started.

Primary references: [Mongoose Model.create/createIndexes](https://mongoosejs.com/docs/api/model.html),
[Node file creation flags](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags)
and [Node env-file loading](https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-filefile).
Behavior is checked against the pinned runtime and Mongoose with real Mongo.

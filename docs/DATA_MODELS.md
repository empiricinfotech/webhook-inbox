# Workspace and inbox metadata models

D04.1 | 29 October 2026

The Express backend now has typed Mongoose 9.11.2 schemas for workspace/inbox
metadata. Imports do not connect to Mongo or register global models. Call
getWorkspaceModel(connection) and getInboxModel(connection) with the existing
caller-owned Mongoose connection. Repeated calls on that same connection reuse
the model. No server startup, health contract or frontend behavior changes.

## Fields and validation

| Collection / field | Rule |
|---|---|
| workspaces.name | Required string, trimmed, 1–100 UTF-16 code units after trimming; no ASCII controls or DEL |
| workspaces.ownerId | Required native ObjectId reference; user existence/ownership is not verified by a schema |
| workspaces.state | active (default) or deleting; required, exact string |
| inboxes.workspaceId | Required native ObjectId reference; immutable after initial insertion |
| inboxes.name | Same bounded display-name rule as workspace names |
| inboxes.description | Optional text with empty-string default; trimmed, max 500 UTF-16 code units; tab/newline/CR permitted, other ASCII controls/DEL rejected; explicit null rejected |
| inboxes.enabled | Required boolean, default true |
| inboxes.retentionDays | Required number, exactly 1, 7 (default), or 30 |
| Both: _id | Mongoose-generated native ObjectId |
| Both: createdAt / updatedAt | Mongoose-managed UTC Date values added on save; later saves retain createdAt and advance updatedAt |

Name/description bounds are initial product decisions because the plan requires
bounded names without prescribing lengths. Names need not be unique; two
workspaces/inboxes may share a display name. Numeric/boolean/string scalar
coercion is disabled per field, without changing global Mongoose settings.
References accept native ObjectIds only, not strings or operator objects.
Future API inputs must use the shared identifier schema and explicitly convert
validated strings, rather than trusting arbitrary objects or model casting.
Unknown document/update fields and unknown query paths are rejected by strict
schemas. Description is plain text; future UI must render it as text.

Normal document validate()/save() checks these rules. Query updates must use
runValidators:true and strict:"throw"; Mongoose update validators are otherwise
opt-in and cannot replace future input allowlists. Explicit strict query options
also reject attempted immutable-field changes rather than silently stripping
them. Replacement, update-pipeline, bulk/raw-driver writes and options that
bypass validation/immutability/timestamps are not a validated application write
interface. No service exposes any write operation in this task. Future services
must validate/allowlist input, enforce workspace access and use these rules.
Do not serialize/log Mongoose validation errors or documents from untrusted input;
existing safe API errors remain the external error boundary.

## Index and connection lifecycle

Schemas disable command buffering, automatic collection creation and automatic
index building. They declare stable list indexes:

- workspaces: ownerId ascending, createdAt descending, _id descending.
- inboxes: workspaceId ascending, createdAt descending, _id descending.

Index creation is explicit with Model.createIndexes() in disposable tests.
Normal application startup is unchanged; the later bootstrap/service must
initialize storage deliberately. No destructive syncIndexes/drop operation is
introduced. These nonunique indexes support future scoped listing, with an ID
tiebreaker. They do not enforce ownership, foreign-key integrity or tenant
isolation. Callers must include the verified workspace scope on every query.

## Test example

The existing API fixture owns its connection, synthetic database and Mongo
process. Inside an extended test under tests/api, this example uses only that
fixture:

```ts
import { Types } from "mongoose";
import { getWorkspaceModel } from "../../apps/api/src/models/workspace.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";

// Inside an extended test receiving { mongo }:
const Workspace = getWorkspaceModel(mongo.connection);
const Inbox = getInboxModel(mongo.connection);
const workspace = await Workspace.create({
  ownerId: new Types.ObjectId(), name: "Synthetic workspace",
});
await Inbox.create({ workspaceId: workspace._id, name: "Synthetic inbox" });
```

Run npm test, or select the unit/API projects with the [testing commands](TESTING.md).
New tests cover boundary lengths, defaults, trimming, missing/null/type/operator
input, lifecycle enums, retention choices, unknown fields, connection ownership,
actual Mongo persistence, timestamp updates, failed-save rollback of stored
values, explicit query validation, immutable workspace references and real indexes.
Scoped-query examples demonstrate data shape; they do not claim authorization.

## Scope and next requirements

D04.1 completes the metadata schema step only. Token/hash/encrypted-token and
verification configuration fields are not yet accepted or stored. They will be
added with their actual invariants in D04.2/provider-verification work rather
than allowing opaque or plaintext placeholders into the current schema.
There is no token generation, encryption, hashed lookup, owner retrieval, token
rotation, local bootstrap, creation service, endpoint or signup flow. Retention
metadata does not yet expire events. An enabled metadata record alone is not a
capture-capable inbox; the capture route does not exist yet.

Day 04's valid capture token and secret-free list acceptance remains dependent
on D04.2 and D04.3. Foreign-key/ownership checks and safe response serialization
belong in later services, not in the metadata persistence layer. No public
hosting, release, capture journey or tenant security is claimed here.

Primary references: [Mongoose validation](https://mongoosejs.com/docs/validation.html),
[timestamps](https://mongoosejs.com/docs/timestamps.html),
[schemas and strict modes](https://mongoosejs.com/docs/guide.html).
Current online docs describe 9.11.4; behavior here is checked against the pinned
9.11.2 source/types and real MongoDB 8.0.32 tests without upgrading dependencies.

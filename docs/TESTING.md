# Unit and API test harnesses

D03.2 | 27 October 2026 | Linux x64 verified

Use pinned Node 24.22.0/npm 11.19.1 and `npm run bootstrap` from the root.
The harness adds Vitest 5.0.5, its explicit Vite 8.3.5 peer, Supertest 7.3.1 and
@types/supertest 7.2.1, all exact MIT-licensed dev dependencies. Application
runtime pins, TypeScript 7 compiler, isolated TS6 lint parser and strict engine/
peer policies are retained. D03.2 added no browser package; D03.3 supplies the [CI workflow](CI.md).

## Run checks

```bash
npm run test:unit
npm run test:api
npm test
npm run check:contracts
```

Each command builds compiled contracts first. `test:unit` selects the unit
project without requiring Mongo; its failure-cleanup test deliberately uses a
missing binary. `test:api` selects the API project and requires MongoDB 8
`mongod` on PATH, or an absolute binary path in MONGOD_BINARY. `npm test` runs
both projects once and exits. Missing test discovery, focused .only tests,
assertion failures and fixture startup/teardown errors fail the command.

The real API tests require permission to bind loopback sockets and start child
processes. A sandbox denial or missing binary is a concrete environment failure,
not a skipped/pass result. No Docker service, normal development database,
Mongo-memory-server download or connection-string environment variable is used.

`vitest.config.ts` selects only tests/unit and tests/api, uses Node/fork isolation,
limits workers to two, restores mocks and environment stubs, and bounds API test/
hook timeouts. Legacy Node tests are deliberately outside Vitest discovery:

```bash
npm run check:foundation
npm run check:routing
npm run check:mongo
npm run check:compiled-api
```

These retain configuration/provider checks, actual Next forwarding and full
source/compiled API Mongo lifecycle/failure/outage coverage. D03.1's six contract
regressions moved, with their assertions preserved, into four unit and two API
checks. check:contracts still selects those six. The broader `test` command adds
new harness/data checks rather than silently dropping the older regressions.

## Owned disposable fixtures

Import the extended test from `tests/helpers/api-fixture.ts`:

```ts
import { expect } from "vitest";
import { test } from "../helpers/api-fixture.js";
import { seedSyntheticRecords } from "../fixtures/synthetic-records.js";

test("sample", async ({ mongo, api }) => {
  await seedSyntheticRecords(mongo);
  expect(await mongo.connection.collection("harness_records").countDocuments()).toBe(2);
  await api.request.get("/health/ready").expect(200);
});
```

The `mongo` fixture lazily creates a new native mongod process bound only to
127.0.0.1 on a free port, an owned temporary directory and random database name.
It exposes an owned Mongoose connection for synthetic seeding, a URI for other
test-owned connections, reset() and idempotent close(). It accepts no caller URI
and does not load dotenv or read MONGODB_URI. Reset drops only the database it
created. Directory removal targets only the mkdtemp result it owns.

The `api` fixture depends on mongo, uses the actual connectDatabase/createApp
code, waits for an owned HTTP server to listen on loopback port 0, and returns a
Supertest client plus the owned server/database handles. Waiting for listen
avoids an ephemeral-port dispatch race. No production route or dependency-injection
hook was added just for tests. There are still no inbox or capture endpoints.

Cleanup order is HTTP connections/server, API Mongo pool, seed connection,
owned Mongo process and owned directory. Vitest registers cleanup before use;
assertion failures still run it. Partial Mongo setup failures also close/remove
owned resources. Graceful Mongo stop has a five-second kill fallback. Do not
reuse a closed fixture; do not close/drop any connection you did not create.

Synthetic seed records live in tests/fixtures, in a harness_records collection.
They demonstrate insert/read/reset/reseed and are not workspace/inbox/event
models. Tests demonstrate separate fixture data, protection of a second active
fixture, ignored caller URI, failure cleanup, readiness 200/503, liveness and
safe correlated 404/HEAD responses. This is resource/data isolation evidence,
not tenant authorization or successful webhook capture.

## Acceptance and current limits

Required checks: clean lockfile bootstrap, dependency smoke, lint, strict types,
normal builds, both new projects and legacy relevant suites. A disposable-copy
probe intentionally fails an assertion after Mongo/API allocation and confirms
nonzero exit, removed data directory and closed resources. A restored run must
pass. An empty selection must also fail. No intentionally failing test is
committed. See [progress](IMPLEMENTATION_PROGRESS.md) for recorded commands.

Browser UI checks are not needed for the harness/CI tasks; no UI behavior changed.
D03.3 automates Day 03's failure/correction demonstration; see [CI evidence](CI.md).
No release, independent review, adoption or GHFind result is claimed. Dependency
audits remain dated evidence; the pre-existing body-parser finding in
[TOOLCHAIN.md](TOOLCHAIN.md#26-october-2026-audit-finding-d031) is unresolved.

References consulted: [Vitest projects](https://vitest.dev/guide/projects.html),
[fixture lifecycle](https://vitest.dev/guide/test-context.html) and
[Supertest](https://github.com/forwardemail/supertest).


## D04.1 metadata checks

The unit project now includes models.test.ts: disconnected, connection-owned
schema validation without Mongo or global casting changes. The API project adds
models.test.ts for real disposable persistence, both models' timestamps, failed
writes, scoped index creation and strict validated updates. npm test discovers
both automatically; no new test runner, dependency or CI bypass is needed.
See [data models](DATA_MODELS.md) for field rules and the precise scope boundary.


## D04.2 capture token checks

The unit/API projects include capture-token.test.ts and capture-tokens.test.ts
for random token encoding, authenticated encryption, key/version/context/hash
failure paths, hidden paired storage, real unique lookup indexes, stored-owner
scoping, concurrent one-time provisioning and safe failures. Secrets/keys exist
only in disposable runtime fixtures and comparisons avoid secret-bearing failure
output. Full repository/CI checks discover these without new dependencies or
runner changes. See [capture token security and scope](CAPTURE_TOKENS.md).

# Local MongoDB and API health

D02.2 | Verified 22 October 2026 | Linux x64

The Express API now opens a Mongoose connection before listening, exposes
process liveness and database readiness, and closes its connection on shutdown.
There are no inbox/event models, capture storage or frontend API requests yet.

## Start MongoDB

From the repository root, with Docker Engine and Compose available:

```bash
docker compose -f infra/compose.mongo.yaml up -d --wait mongo
```

The Compose file uses the official Mongo image at version 8.0.32 and a pinned
manifest digest. It publishes only `127.0.0.1:27017`, with named data/config
volumes and a ping health check. It contains Mongo only; the frontend and API
still run as separate local processes. Full application Compose deployment is
later work.

The development database has no authentication and is intended for local
synthetic data only. Do not expose it on a public interface or reuse it for
client/production data. MongoDB has its own upstream license; the repository's
MIT license does not relicense the server image.

If 27017 is occupied, choose a free local port and use that port consistently:

```bash
MONGO_PORT=27018 docker compose -f infra/compose.mongo.yaml up -d --wait mongo
```

Stop this development service without deleting its data:

```bash
docker compose -f infra/compose.mongo.yaml down
```

Named volumes persist across down/up. The service does not seed users, create
application collections or modify an existing Mongo installation. If using an
existing local MongoDB instead, supply its development URI to the API; do not
point tests at a real project database.

## Start and check the API

Activate Node 24.22.0/npm 11.19.1 and run `npm run bootstrap` as documented in
[local development](LOCAL_DEVELOPMENT.md). Then, in a POSIX shell:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/webhook_inbox API_PORT=4000 npm run dev:api
```

The example URI has no credentials. Supply real configuration through your
local secret mechanism; do not paste credential-bearing URLs into issues or
screenshots. API environment files are not automatically loaded yet; placeholder
configuration files and consolidated scripts remain D02.3 work.

`MONGODB_URI` is required, bounded to 4096 characters and accepts MongoDB URI
schemes without whitespace. The Mongo driver validates detailed URI options and
authentication. Missing/malformed configuration names the rejected fields and
exits 1 before binding. A connection/authentication/parser failure emits only
`MONGODB_CONNECTION_FAILED` and a generic message, then exits 1.
The URL, database name, credentials and raw driver error are never logged.

Initial connection uses 5000ms server-selection/connect timeouts, a pool maximum
of ten, and disabled Mongoose operation buffering/automatic collection/index
creation. Initial failure is not silently retried by the application. After a
successful connection, the driver can reconnect following an outage; there are
no capture or replay operations to retry in this task.

```bash
curl -i http://127.0.0.1:4000/health/live
curl -i http://127.0.0.1:4000/health/ready
```

| Route | Meaning | Response |
|---|---|---|
| `GET /health/live` | HTTP process is running | 200, `{"data":{"status":"live"}}` |
| `GET /health/ready` | Connected Mongo responds to a bounded ping | 200, `{"data":{"status":"ready"}}` |
| `GET /health/ready` during failure | Mongo disconnected, stalled or probe failed | 503, `{"data":{"status":"not_ready"}}` |

Health snapshots contain no connection metadata and use `Cache-Control:
no-store`. Express's HEAD behavior returns the corresponding status without a
body. Other routes still return plain 404. These operational snapshots do not
implement the shared management error/correlation contract planned in D03.1.

Readiness performs a real Mongo ping with a 1000ms client operation budget when
connected, rather than trusting a stale connected flag. On disconnect it fails
without waiting for reconnection. Process liveness stays healthy during a
database outage, and readiness becomes healthy again once Mongo is reachable.
This is basic dependency readiness, not the metrics, worker-lag or performance
work planned for D35.

Ctrl+C/SIGTERM stops HTTP acceptance and marks readiness unavailable, drains
HTTP requests, then closes the Mongo pool. A five-second shutdown deadline
forces termination with exit code 1 if draining/closing stalls. A bind failure
also closes the newly opened pool before exiting.

## Verification

```bash
npm run check:foundation
npm run check:mongo
docker compose -f infra/compose.mongo.yaml config --quiet
npm exec -- tsc -p apps/api/tsconfig.json
npm exec -- tsc -p tests/tsconfig.json
```

`check:foundation` remains database-independent: schemas, safe configuration
errors, provider isolation and injected readiness/HTTP behavior.

`check:mongo` requires a local MongoDB 8 `mongod` executable on PATH (or its
absolute path in `MONGOD_BINARY`). It starts its own isolated loopback process
and temporary data directory, verifies real startup/bind-failure cleanup,
credential/parser errors, stalled ping, outage/restart recovery and clean API
shutdown, then removes only its test data. It deliberately pauses/stops only
the Mongo process it created. It does not read a caller's MONGODB_URI, drop an
existing database, or connect to your development service.

These checks use the existing Node test/tsx tooling. They do not install
Vitest/Supertest or implement D03.2's broader disposable-data harness. The
Compose service was additionally started under a unique test project/port and
checked through the actual API; its disposable containers/volumes were removed
after verification. Normal development data volumes were untouched.

## Primary references

- [Mongoose connections and error handling](https://mongoosejs.com/docs/connections.html).
- [MongoDB command operation timeout](https://www.mongodb.com/docs/manual/reference/connection-string-options/#timeout-options).
- [Official Mongo container image](https://hub.docker.com/_/mongo).

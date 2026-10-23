# Local development foundation

D02.1–D02.3 | Verified 23 October 2026 | Linux x64

Next.js serves the overview (`/`), setup (`/setup`) and missing-page shell.
Express owns the MongoDB connection and health routes. Development management
requests under `/api/v1` now reach Express through the frontend origin. Domain
endpoints and the first capture journey remain future tasks.

## Start from a clean checkout

Activate [Node 24.22.0/npm 11.19.1](TOOLCHAIN.md), then run from the root:

```bash
npm run bootstrap
npm run check:toolchain
npm run check:dependencies
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local
docker compose -f infra/compose.mongo.yaml up -d --wait mongo
```

Copy the examples only when local files do not already exist; preserve your
configuration. Both examples contain public, credential-free loopback values.
Keep real environment files ignored. See [Mongo setup](MONGODB_LOCAL.md) for
native Mongo, port conflicts, persistent volumes and outage behavior.

In separate terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open [the overview](http://127.0.0.1:3000/) or reload
[local setup](http://127.0.0.1:3000/setup) directly. Next reports an alternate
port if 3000 is occupied. Both services bind to loopback. Stop with Ctrl+C.
Express also handles SIGTERM, closes its Mongo pool and has a five-second
shutdown deadline.

## Configuration and routing

| Variable | Process | Rule |
|---|---|---|
| `NODE_ENV` | API and Next configuration | `development`, `test` or `production`; defaults to development when parsed directly; Next CLI selects its normal mode |
| `API_PORT` | API | Required decimal integer string, 1–65535 |
| `API_HOST` | API | `127.0.0.1` (default) or `::1`; other binding rejected |
| `MONGODB_URI` | API | Required Mongo URI, at most 4096 characters; never logged |
| `API_ORIGIN` | Next server configuration | Required for `next dev`; HTTP loopback origin (`127.0.0.1`, `localhost` or `[::1]`), no credentials, path, query or fragment; optional outside development |

API dev/start commands use Node's `--env-file-if-exists=.env.local` from
`apps/api`; existing process values take precedence. The file is optional so
an operator can supply configuration through the process environment. Required
API fields still fail validation before listening. Next loads its own `.env*`
files from `apps/web`, including `.env.local`; it does not load them from `src`.
Do not use `NODE_ENV` to select a port or expose these values with `NEXT_PUBLIC_`.
No API origin, Mongo URI or credentials are passed to Client Components.

If the API port changes, update `API_ORIGIN` to match and restart Next.
Next's development-only rewrite forwards `/api/v1` and `/api/v1/:path*` to the
same paths on Express, preserving methods, query strings, bodies and cookies.
Health and capture are deliberately outside this rewrite:

```bash
curl -i http://127.0.0.1:4000/health/ready
curl -i http://127.0.0.1:3000/api/v1/inboxes
```

Readiness returns 200/ready after a bounded Mongo ping, or 503/not_ready during
an outage; liveness is `/health/live`. The second request currently returns
Express's plain `404 Not found` because management features are unimplemented.
That is an expected transport check, not successful inbox creation. Future
providers send original requests directly to Express `/capture/:token`.

Production builds install no development API rewrite and need no API_ORIGIN.
A later shared-origin reverse proxy must route `/api/v1`, capture and health to
Express and frontend assets/pages to Next. `next start` alone does not supply
that deployment topology. This unauthenticated foundation remains local-only.

Shared Zod helpers live in `packages/contracts/src/environment.ts`; each app
validates an explicit allowlist. Invalid configuration reports field names
without values. Mongo must connect before Express binds. Binding failures
report only a safe code such as EADDRINUSE.

## Build and run emitted output

```bash
npm run lint
npm run typecheck
npm run build
# Separate terminals, after configuring Mongo and API environment:
npm run start:api
npm run start:web
```

`build` compiles contracts first (JavaScript and declarations), then Express
JavaScript, then Next's production webpack output. `build:api`, `build:web` and
`build:contracts` are also available. API output is `apps/api/dist`, contracts
output is `packages/contracts/dist`, and Next uses `apps/web/.next`.
`start:api` runs `dist/index.js` with plain Node; no tsx or TypeScript runtime
is required by the API. Use NODE_ENV=production through the process environment
when running a production API; the example file is for development.

All runtime consumers use the compiled contracts export. Root development,
build, test and typecheck commands build it first. After editing shared contract
source, rebuild contracts and restart consumers. Direct workspace commands
require the shared build already present. Worker/test-data still contain no
runtime source, so they do not have artificial build scripts.

`typecheck` generates Next route types, checks every implemented workspace and
the tests with TypeScript 7, and leaves `skipLibCheck: false`. Web and mixed
Next test imports use Bundler resolution; backend output uses NodeNext. Ignored
Next generated types load through its active `next-env.d.ts` bridge; generated
dev/build directories are excluded from root discovery to avoid duplicate
global declarations. Do not run dev and build concurrently in the same checkout.

`lint` invokes the isolated ESLint 10 workspace with JavaScript/TypeScript
recommended rules and React Hooks rules for the frontend. See
[the tooling decision](TOOLCHAIN.md#d023-tooling-update) for parser compatibility
and the intentionally excluded Next preset. Generated output, dependencies and
test reports are ignored; warnings fail the lint command.

## Verification commands

```bash
npm run check:foundation
npm run check:routing
npm run check:mongo
npm run check:compiled-api
git diff --check
```

Foundation has five configuration/provider/health checks. Routing has three
checks: safe development target validation, real config phase behavior and a
real Next proxy against a synthetic transport backend. It verifies GET/POST,
query encoding, exact body, request/response cookies, headers/status and excluded
capture/health/lookalike paths. It copies no caller environment files and adds
no product endpoint. Mongo tests require a native MongoDB 8 binary (or
MONGOD_BINARY), use isolated temporary data and test startup, failures, bounded
readiness, outage/recovery and shutdown. `check:compiled-api` repeats them with
the emitted API and Node TypeScript stripping disabled.

D02.3 verification includes frozen clean-copy installation, lint, strict types,
production build, the checks above, deliberate lint/type failures in disposable
copies and actual dev/prod startup. Browser checks cover direct setup reload,
navigation and current configuration instructions. Actual HTTP checks verify
forwarded Express 404s; the in-app browser blocks direct viewing of that plain
404 response.
No inbox capture, independent user trial, hosted deployment or release is claimed.
On this constrained verification host, CIRCLE_NODE_TOTAL=2 limits build workers;
no resource override is committed. Detailed results are in
[implementation progress](IMPLEMENTATION_PROGRESS.md).

## Boundaries and references

Pages/layout remain Server Components; QueryProvider is a Client Component with
one lazily initialized QueryClient per mounted tree. Express retains app/startup
separation and no global JSON parser. No domain database/auth logic moves into
Next. Tailwind/PostCSS remains pinned; no external font/analytics request is
needed. The worker is still a dependency-only placeholder.

Consulted installed Next.js 16.4.2 guides on rewrites, environment variables,
ESLint and TypeScript before editing. Also see the official
[rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites),
[environment](https://nextjs.org/docs/app/guides/environment-variables) and
[TypeScript](https://nextjs.org/docs/app/api-reference/config/typescript) guides.

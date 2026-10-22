# Local development shell

D02.1 | Verified 22 October 2026 | Linux x64

The repository now starts a Next.js App Router shell and a separate Express process.
The shell has an overview (`/`), local setup (`/setup`), shared layout/navigation,
and a missing-page view. It does not create inboxes, capture events or connect to
MongoDB. D02.2 adds Mongo/health; D02.3 adds lint/build/typecheck scripts, the
same-origin development API route and placeholder environment files.

## Start from a clean checkout

Use the [pinned Node/npm pair](TOOLCHAIN.md): Node 24.22.0 and npm 11.19.1.
After activating it in the repository root:

```bash
npm run bootstrap
npm run check:toolchain
npm run check:dependencies
npm run check:foundation
```

In one terminal, start the API (POSIX shell):

```bash
API_PORT=4000 npm run dev:api
```

In another terminal, start the frontend:

```bash
npm run dev:web
```

Open [the overview](http://127.0.0.1:3000/) or navigate directly to
[local setup](http://127.0.0.1:3000/setup). Use the port reported by Next.js if
3000 is already occupied. Both commands bind to loopback. Stop them with Ctrl+C.
The API also handles SIGTERM and gives active connections up to five seconds
before forced shutdown with a failing exit status.

These are separate services. The frontend currently makes no management API
requests, and Express deliberately returns plain 404 responses for all paths.
For example, `curl -i http://127.0.0.1:4000/api/v1/inboxes` returns 404.
Health, capture, persistence and same-origin proxying have not been implemented;
a successful process start is not dependency readiness or capture success.
The unauthenticated foundation is for local development only.

## Environment contract

| Variable | Process | Rule |
|---|---|---|
| `NODE_ENV` | API and Next configuration | `development`, `test` or `production`; defaults to development when parsed directly; the Next CLI selects its normal mode when unset |
| `API_PORT` | API | Required decimal integer string, 1–65535; no implicit default |
| `API_HOST` | API | `127.0.0.1` (default) or `::1`; non-loopback binding is rejected |

API configuration is supplied through the process environment. There is no
automatic API dotenv loading in this task. Next.js uses its normal environment
loading, but needs no additional custom variables for this shell. Do not set
`NODE_ENV` merely to select a local port.

Shared Zod helpers live in `packages/contracts/src/environment.ts`; each
application defines only its own configuration schema. Parsing passes an
explicit allowlist of fields, drops unrelated environment values and reports
invalid field names without echoing their values. The API exits with code 1
before binding if a required field is missing or invalid. Binding failures
report an error code (for example `EADDRINUSE`) and exit with code 1.
Next configuration also fails if its environment schema rejects a value.

No Mongo URL, session key or other future credential is required yet. No server
configuration is passed into the Client Component provider or exposed using
`NEXT_PUBLIC_` variables. Placeholder environment files remain D02.3 work.

## Component and service boundaries

- Root layout and pages are Server Components. Navigation uses Next.js Link.
- `QueryProvider` is an explicit Client Component, wrapping page content below
  the static header. It creates one QueryClient per mounted tree with lazy
  state initialization, with no process-wide cache of private data.
- Shared contracts export TypeScript source for Next/tsx during this foundation
  stage. Next lists the package in `transpilePackages`. Distributable backend
  compilation is D02.3 work.
- TypeScript configurations extend `tsconfig.base.json`. The frontend uses
  Bundler resolution and DOM/ES2024 libraries; API/contracts use NodeNext.
  Strictness includes `skipLibCheck: false`.
- Tailwind's existing pinned PostCSS plugin processes the shell stylesheet.
  No font service, analytics, database or external runtime request is needed.
- Express startup and app construction are separate for verification. No global
  JSON parser is installed: later capture verification needs original bytes.
- The worker remains a dependency-only placeholder and is not started.

## Checks available for this task

`npm run check:foundation` uses the existing tsx runner and Node's built-in test
API; it does not introduce the Vitest/Supertest/database harness planned for
D03.2. Its five checks cover valid/invalid configuration, sanitized failure
output, query-cache isolation across render trees, real API startup, safe 404s,
port conflicts and graceful shutdown.

Until D02.3 adds consolidated scripts, use these direct compiler checks from the
root:

```bash
npm exec -- tsc -p packages/contracts/tsconfig.json
npm exec -- tsc -p apps/api/tsconfig.json
npm exec -- tsc -p apps/web/tsconfig.json
npm exec -- tsc -p tests/tsconfig.json
npm exec --workspace=@empiric-webhook-inbox/web -- next build --webpack
git diff --check
```

Next generates its ignored `next-env.d.ts` and `.next/` type bridge during dev
or build. The frontend loads the active generated route types through that bridge.
The generated directory is excluded from root file discovery so dev and build
outputs can coexist without loading duplicate global helper declarations;
source checks remain strict with `skipLibCheck: false`. Build output, installed dependencies and incremental
metadata remain ignored. On a constrained verification host,
`CIRCLE_NODE_TOTAL=2` was used for one Next build worker; no resource override
is committed.

Verification demonstrated the production webpack build, Turbopack development
startup, direct `/setup` reload, Next Link navigation in both directions,
missing-page recovery, keyboard skip-link focus and both pages at a 390px
viewport without document overflow. Browser warning/error logs were empty
during those flows. This is shell verification, not an inbox/capture release,
a database readiness check or an independent fresh-user trial.

## References

- [Next.js pages and layouts](https://nextjs.org/docs/app/getting-started/layouts-and-pages)
  and [Server/Client Component boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- [Next.js TypeScript](https://nextjs.org/docs/app/api-reference/config/typescript).
- [Express shutdown guidance](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/).

The installed Next.js 16.4.2 guides under `node_modules/next/dist/docs/` were
also consulted before implementation.

# Local inbox interface

D05.1 | 30 October 2026

A maintainer can list inboxes, create one with a name/description, open its saved
metadata and reload the detail URL. The interface has loading, validation,
connection-error, missing-inbox and empty states. Data flows from Next.js Client
Components through same-origin /api/v1 to Express and Mongo. Next never connects
to Mongo or receives the encryption key. This is an unauthenticated local-only
preview, not a hosted dashboard or a working capture endpoint.

## Start the interface

Use the pinned toolchain and npm run bootstrap. Preserve existing local files
when following [local development](LOCAL_DEVELOPMENT.md). Start Mongo, then run:

```bash
# Once per local workspace; preserve existing operator configuration.
npm run local:inbox -- init
npm run local:inbox -- bootstrap
# Terminal one: uses the private .env.inbox.local configuration.
npm run local:dashboard
# Terminal two: uses apps/web/.env.local and its existing API_ORIGIN.
npm run dev:web
```

Open [inboxes](http://127.0.0.1:3000/inboxes). Create inbox links open /inboxes/new;
a saved inbox opens /inboxes/:id. CLI-created inboxes in the configured workspace
appear on refresh. Empty descriptions remain explicit, and inbox names/descriptions
are rendered as text. Forms validate against shared bounds and keep input after
server/network errors. Creation is never automatically retried: after an uncertain
write, check the list before submitting again. A successful create invalidates the
list query and seeds the detail cache; normal detail reads still recheck storage.

The API command binds only 127.0.0.1, defaults to port 4000 and requires valid
D04.3 private operator config. API_PORT may override the port; LOCAL_WEB_ORIGIN
must match the browser origin exactly (default http://127.0.0.1:3000). Only HTTP
literal-loopback web origins without credentials/path/query/fragment are allowed.
If Next chooses a different port, set LOCAL_WEB_ORIGIN accordingly and restart
the local API. API_ORIGIN in the web's private configuration must target the API
port. Process values take precedence over local files. No existing config file
is overwritten, and no NEXT_PUBLIC_ secret or actor selector is introduced.

Do not also run dev:api on the same port. dev:api/start:api remain the health-only
foundation; local:dashboard is the explicit opt-in path for this preview. The
operator command uses the production-compiled backend with plain Node, but refuses
NODE_ENV=production and nonlocal Mongo targets. It is not production deployment
configuration. Production Next builds still have no development API rewrite;
shared-origin hosted routing/authentication are future work.

## HTTP and storage boundaries

Only the opted-in local dashboard API mounts these routes:

| Route | Result |
|---|---|
| GET /api/v1/local-workspace | Active configured workspace ID/name after stored-owner check |
| GET /api/v1/workspaces/:workspaceId/inboxes | Bounded data/nextCursor page; default 25, max 100; newest createdAt/_id first |
| POST /api/v1/workspaces/:workspaceId/inboxes | Strict JSON creation, 201/data and Location; uses the atomic credentialed creation service |
| GET /api/v1/inboxes/:id | Owner/workspace-scoped safe metadata, or inaccessible/missing 404 |

The trusted actor/workspace come only from private server config. Headers, query
and body cannot choose a different actor; foreign workspace/inbox IDs fail safely.
Stored active ownership is checked on every service request. These predicates
are not cookie sessions, memberships or multi-user authentication. As before,
owner checks and writes are separate; later transfer/deletion tasks must define
their concurrency policy.

Host must match the configured API or web host. Cross-site fetches, foreign/null
Origin and POSTs without the exact configured web Origin are denied before body
parsing. No CORS permission is granted. These are local browser request/rebinding
protections, not protection against trusted local processes. Never expose this
entry point through a public proxy/tunnel. Normal API startup mounts no local
management routes.

The JSON parser is route-local, limited to 4 KiB and rejects compression with
inflate:false. Capture/health/unmatched routes never get a global body parser.
Safe shared errors use 400/403/404/413/415/503, no private parser/driver/body cause,
a fresh request ID and Cache-Control:no-store. The existing pinned body-parser
advisory remains unresolved as a dependency update; the new route uses the
[documented compression workaround](https://github.com/advisories/GHSA-27r3-jxmh-p828)
and verifies rejection plus continued liveness. This is not a fresh all-clear audit.

Pagination decodes only a validated canonical base64url tuple of workspace ID,
UTC date and inbox ID. It cannot supply Mongo operators and must match the active
scope. It uses the existing compound index, a limit-plus-one query and an ID
tiebreaker. Legacy internal CLI arrays remain unchanged; this HTTP page contract
does not implement event pagination (D08.2) or quota reservations (D34.1).

Creation/list/detail return an explicit metadata DTO, never raw tokens, token
hashes, encrypted envelopes, keys, capture URLs or owner IDs. Browser responses
are Zod-validated and fetched with no-store and a bounded timeout. Query state is
scoped by workspace and inbox; no private server fetch is cached in an RSC/shared
page. The existing per-tree QueryProvider owns client caches. Future logout and
workspace switching must clear caches; no such session flow is claimed now.

## Verification and scope

Ten new normal-suite regressions cover real local context/create/detail/list,
pagination ordering/no gaps, inaccessible scopes/changed owner, Origin/Host/fetch-
site guards, body limits/invalid/compressed bodies, absent normal API routes,
storage failures, client response allowlists/safe errors and local origin config.
Browser verification uses a separate Next/Express/owned Mongo fixture with runtime-
only synthetic keys and data; normal developer databases/files stay untouched.
The progress record contains exact checks and observed browser results.

The detail view shows saved settings and an honest placeholder for future capture.
It does not display a fake event count or an active capture URL. Rename, disable
and token rotation are D05.2; their validation/old-token/disabled-response checks
are D05.3. Thus Day 05's complete acceptance remains pending those tasks.
No session/signup/membership, capture processing, event list, token reveal or
rotation endpoint, worker, release or deployment is added. D05.2 is next and is
not started in this run.

See [local operator setup](LOCAL_INBOX.md), [testing](TESTING.md) and
[implementation progress](IMPLEMENTATION_PROGRESS.md). Relevant installed Next
16.4.2 guides on page/layout/client boundaries, loading and dynamic params were
read before editing. TanStack Query handles fetching, mutations and invalidation
using the existing pinned version; no dependencies changed.

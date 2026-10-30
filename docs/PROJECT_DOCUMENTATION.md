# Empiric Webhook Inbox Project Documentation

MERN implementation with a Next.js frontend and 40 day development backlog

Version 1.1 | 21 October 2026 | Prepared for Empiric Infotech

Build a public, self-hostable developer tool that receives webhook messages, makes them easy to inspect, and helps a small team debug integrations. Deliver a working local version first, then add authenticated workspaces, controlled replay, and a documented public release. Use this document to understand the system, select the next task, and verify that each increment works.

Planning assumption: one developer with working MERN knowledge, approximately 5 to 6 focused hours per development day, for about 200 to 240 hours. These are development days, not a calendar commitment. Beginners and teams adding production requirements should allow more time. Every task is proposed work; nothing in this document claims that the application already exists.

## How to use this document

Read the overview and architecture first. Find your next unfinished day in the backlog, confirm its prerequisites, and create an issue using its task ID. Complete the acceptance check before advancing. Each day contains three implementation tasks, giving 120 tasks in total. Testing, documentation, review, and a useful commit are part of the day, not extra count-building work.

Task IDs use D01.1 through D40.3. Module IDs use M01 through M18. Complete one logically coherent change per PR; combine small related tasks when appropriate. A day can span several sessions. If an acceptance check fails, finish or fix that work before adding dependent features.

### Document map

1. Product overview and scope
2. Technology stack and architecture
3. User journeys and processing flows
4. Module specifications
5. Data model and API contracts
6. Operating defaults and quality requirements
7. Forty day ordered backlog
8. Delivery workflow and release gates
9. Public project growth and score tracking
10. References and later opportunities

## 1 Product overview and scope

### Problem and intended users

A developer integrating GitHub or another webhook provider needs to know whether an event arrived, what the sender supplied, and how the receiving application behaved. Logs are often scattered, difficult to search, or unavailable to another team member. The Inbox gives the team an inspectable history and a repeatable debugging workflow.

Primary users are MERN developers, integration engineers, QA testers and small agency teams. Empiric can use the tool during its own integration work and improve it from real feedback. A first example is receiving a GitHub issue event, inspecting its redacted JSON, and later sending a sanitized test copy to a configured receiver.

### Product boundary

This project is a debugging inbox. It acknowledges that it captured an inbound message. It does not promise delivery to a business application and is not a production payment processor or enterprise event gateway. Receiving an event successfully does not mean a replay destination processed it successfully.

The public repository contains the application, tests, example requests and setup instructions. A public repository does not make deployed inbox data public. Captured data stays behind workspace access controls. Use synthetic data in screenshots and the shared demo.

### Release sequence

| Milestone | Days | Outcome | Access |
|---|---|---|---|
| Local preview v0.1 | 1 to 10 | Create an inbox, capture a request, inspect and delete it | Local development only |
| Authenticated beta v0.2 | 11 to 20 | Sessions, ownership, filtering, expiry, private deployment | Invited testers |
| Team and replay beta v0.3 | 21 to 30 | Roles, annotations, audit history, destinations and replay jobs | Restricted beta |
| Public release v1.0 | 31 to 40 | Compare, export, tokens, metrics, recovery checks and documentation | Public code and documented deployment |

Days 19, 29 and 39 include stabilization time. Day 40 is release work. If capacity slips, defer optional display polish or new integration examples; keep authorization, payload limits, replay controls and end-to-end validation.

### What is outside the first 40 days

Billing, subscriptions, AI summaries, mobile apps, Kubernetes, unlimited retention, anonymous public sharing, arbitrary JavaScript transformations, exact byte-for-byte raw replay, guaranteed exactly-once delivery, enterprise SSO and a custom localhost tunnel are outside scope. Existing local tunneling tools can be documented later; the product does not implement a tunnel in v1.0.

### Product success measures

- A new developer follows the README and captures a sample event without private help.
- Two users in different workspaces cannot read or act on each other's data.
- A tester can trace an inbound event through inspection and any replay attempts.
- The development team records real setup failures and resolves them before launch.
- Release notes, tests and examples remain consistent with the shipped version.

Usage and reliability matter first. GHFind score movement is a separate observation, not a release criterion.

## 2 Technology stack and architecture

### Recommended stack

| Layer | Choice | Purpose |
|---|---|---|
| Language | TypeScript throughout | Shared types and clearer refactoring |
| Runtime | Node.js 24 LTS baseline | Next.js frontend server, API and background worker runtime |
| Frontend | Next.js with React, TypeScript and App Router | Dashboard, file-based routes, layouts and interaction |
| Styling | Tailwind CSS | Responsive layout and consistent styles |
| Server state | TanStack Query in Client Components | Fetching, mutations and browser cache invalidation |
| Backend | Express | REST API, capture route and event stream |
| Database | MongoDB with Mongoose | Workspace data, messages, sessions and jobs |
| Validation | Zod | Request contracts and environment validation |
| Authentication | Opaque server sessions in cookies | Revocable browser sessions |
| Live updates | Server Sent Events | One-way updates with polling fallback |
| Worker | Separate Node process using Mongo job records | Replay attempts, leases and retention cleanup |
| Logging | Pino with redaction | Structured request and worker logs |
| Tests | Vitest, Supertest and Playwright | Logic, API and browser verification |
| Local environment | Docker Compose | Repeatable app and Mongo services |
| Automation | GitHub Actions | Checks on PRs and release builds |
| API reference | OpenAPI | Searchable contracts and examples |

Node's official release page lists version 24 as LTS on the research date. Confirm supported versions when starting and commit a lockfile. Library choices are design recommendations, not claims that all current versions are compatible without checking. Pin compatible versions during D01.

MongoDB keeps the first release within MERN. The job worker polls durable job records and claims work atomically; Redis and a separate queue service are not required. This choice limits initial throughput but reduces operational complexity for a small debugging tool.

### Frontend routing and rendering

Use the Next.js App Router for file-based pages, shared layouts, navigation, loading states and error boundaries. Use Next.js Link and navigation APIs for frontend routing. Server Components provide page and layout composition; put interactive forms, TanStack Query providers, event inspection controls and SSE subscriptions behind explicit Client Component boundaries.

Express remains the source of truth for authentication, authorization, database access, capture, replay and management endpoints. Keep those operations in the existing backend; the Next.js frontend consumes its API. UI route guards improve navigation but do not replace backend permission checks.

For v1.0, load private dashboard data through the authenticated API from Client Components. If a later page fetches private data in a Server Component, forward only that user's required session context and use request-specific, uncached fetching. Never place private event data in a shared page or data cache. Clear browser query caches and close SSE subscriptions on logout or workspace changes.

Keep secrets in server-only configuration. Any NEXT_PUBLIC_ variable is browser-visible; use it only for non-sensitive values. Browser requests use the same-origin /api/v1 prefix. Configure a development reverse proxy or Next.js rewrite for that prefix, and send provider capture requests directly to Express so their raw bytes reach the signature verifier unchanged.

### Runtime components

1. The Next.js application renders the frontend; its interactive Client Components call the Express management API under /api/v1.
2. A provider sends requests to /capture/:token without a browser session.
3. The API validates limits, checks inbox configuration, verifies signatures where enabled, redacts data, and persists the event.
4. The API acknowledges capture only after the event is stored.
5. The dashboard reads events and receives lightweight live-update notifications.
6. Replay requests create a durable job; a separate worker sends the sanitized copy and records the result.
7. MongoDB stores application state. Retention cleanup and job recovery run in the worker.

### Architecture flow

```text
Provider ----> Express capture route ----> Mongo events
                    |                         |
                    +--> capture response     |
                                              v
Next.js dashboard <-- Express management API and SSE
                              |
                              v
                       Mongo replay jobs
                              |
                              v
                         Node worker
                              |
                              v
                      Approved destination
```

Production uses one HTTPS origin through a reverse proxy. Route /api/v1, /capture and /health to Express, and route frontend pages and /_next assets to the Next.js server. Pass the Express SSE stream through without response buffering. The initial beta uses one Next.js frontend instance, one API instance and one worker. Avoid adding multiple API replicas until live fan-out and rate-limit coordination are implemented. Sessions are database-backed; an instance restart does not by itself delete session records.

### Repository structure

```text
apps/web/src/app/       Next.js App Router pages and layouts
apps/web/src/features/  Interactive Client Components and hooks
apps/web/src/components/ Shared frontend components
apps/web/src/lib/       API client and browser query providers
apps/api/src/           Express routes and domain services
apps/worker/src/        Job claims, replay and cleanup
packages/contracts/    Shared schemas and API types
packages/test-data/    Synthetic webhook fixtures
docs/                  Setup, architecture and examples
tests/e2e/             Browser journeys
infra/                 Compose and proxy configuration
.github/               CI and contribution templates
```

Each feature separates routes, validation, services and persistence. UI components must not define authorization rules. The API and worker enforce permissions independently at their boundaries.

## 3 User journeys and processing flows

### Journey A First successful capture

1. A maintainer starts the local stack and creates an inbox.
2. The application generates an unguessable capture token and displays its URL.
3. The maintainer sends the provided synthetic JSON sample to that URL.
4. The capture route stores a redacted event and returns its event ID.
5. The request list refreshes and the maintainer opens the event detail.
6. The detail shows time, method, content type, signature state and safe payload.

A missing inbox returns 404, a disabled inbox returns 410, a body over the limit returns 413, and a storage failure returns 503. These failures never produce a success message in the dashboard.

### Journey B Team debugging

1. An owner signs in and creates a workspace.
2. The owner creates a member invitation and copies its one-time link.
3. The invited user signs in using the invited address and accepts it.
4. The member filters events, adds tags, bookmarks an example and comments on a finding.
5. A viewer can inspect data but cannot change configuration or trigger delivery.
6. The audit page records actions without copying webhook payloads into the audit log.

### Journey C Receive a signed GitHub message

1. An owner configures an inbox with GitHub verification enabled.
2. The server decrypts the stored verification secret only for this operation.
3. The capture route reads bounded raw bytes before any JSON transformation.
4. It calculates the HMAC and compares the signature in constant time.
5. A valid request is sanitized and stored; an invalid request is rejected without retaining its body.
6. The detail page shows verified or unverified status. Generic inboxes explicitly show that authenticity was not verified.

GitHub's validation guide requires checking the signature against the original payload. Redacting the payload before verification would change that input. Source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

### Journey D Replay a test copy

1. An owner registers a destination matching the deployment's operator allowlist.
2. A member opens an event and chooses that destination.
3. The UI explains that the replay uses the stored sanitized content, then previews the outgoing request.
4. A confirmation creates a job with an idempotency key.
5. The worker validates the destination again and sends one attempt with a timeout.
6. The detail page shows the response status, timing and bounded redacted response preview.
7. A failed or timed-out attempt is visible. A manual retry creates a new linked job.

The original provider signature is never forwarded as valid authentication for a changed body. v1.0 has no automatic retries because a timeout does not prove that the destination performed no action. Destinations should deduplicate using the stable replay-job ID if needed.

### Journey E Expiry and deletion

1. Each event gets expiresAt based on the inbox retention setting.
2. Every read, export, stream lookup and replay checks that the event is not expired or deleted.
3. A user deletion sets deletedAt immediately and queues physical cleanup.
4. Cleanup removes dependent notes and attempt previews according to the policy.
5. Mongo TTL eventually removes event records. It is a cleanup mechanism, not the access-control boundary.

MongoDB documents that TTL deletion is performed in the background and is not immediate. Source: https://www.mongodb.com/docs/manual/core/index-ttl/

## 4 Module specifications

Each module has a purpose, defined behaviour and a completion check. Day references locate the implementation work in the backlog.

### M01 Project foundation

**Implementation window:** D01 to D03.

Provide a repeatable TypeScript monorepo and local stack.

**Features:** Environment validation, scripts, shared contracts, API health, Next.js App Router pages and layouts, Client Component query providers and CI.

**Rules and edge cases:** A missing required variable stops startup with a clear message. A fresh clone can start using the documented commands.

**Completion check:** The Next.js production build, type checks and Express health smoke test pass; direct navigation to a frontend route works.

### M02 Workspace and inbox management

**Implementation window:** D04 to D05 and D14 to D15.

Organize captures by project and environment.

**Features:** Workspace selector, inbox list, name, description, enabled state, retention and token rotation.

**Rules and edge cases:** Names are bounded and validated. Capture tokens are generated with at least 256 bits of randomness; index their hashes and mask tokenized URLs in logs. Rotation invalidates the old token.

**Completion check:** Create, rename, disable and rotate an inbox; another workspace cannot manage it.

### M03 Capture pipeline

**Implementation window:** D06 to D07.

Accept bounded webhook messages and preserve useful debugging evidence.

**Features:** Capture URL, HTTP method, safe headers, normalized content type, safe body, received time and response status.

**Rules and edge cases:** Limit bodies to 256 KiB initially. Accept JSON, text and form data; reject unsupported binary and compressed bodies in v1.0. Store no raw vault. GET and HEAD produce metadata events; the receiver does not forward messages.

**Completion check:** Valid samples persist once per delivery; oversized and unsupported bodies produce clear errors.

### M04 Request explorer

**Implementation window:** D08 to D09 and D16.

Find and inspect a captured message.

**Features:** Cursor pagination, method and date filters, readable JSON, raw sanitized text and metadata views.

**Rules and edge cases:** Sort by receivedAt and ID. Render text safely. Show redaction and parse-failure indicators. Body filters cover explicitly indexed metadata in v1.0, not arbitrary regex over all payloads.

**Completion check:** Pagination has no duplicates in stable data; HTML payloads render as text.

### M05 Accounts and sessions

**Implementation window:** D11 to D13.

Provide revocable access to captured data.

**Features:** Invite-only registration, password login, logout, current user and recovery codes.

**Rules and edge cases:** Use a maintained Argon2id library. Store hashed opaque sessions; use HttpOnly Secure SameSite cookies, origin checks and CSRF tokens for state changes. No browser tokens in localStorage.

**Completion check:** Invalid credentials are generic; logout and password recovery revoke sessions.

### M06 Tenant authorization

**Implementation window:** D14 and D21 to D22.

Control access using workspace membership.

**Features:** Owner, member and viewer roles; membership revocation and invitation acceptance.

**Rules and edge cases:** Every query includes workspace scope from a verified membership. SSE and worker operations recheck access. Owner transfer is atomic and the last owner cannot be removed.

**Completion check:** Cross-workspace read and write tests fail safely; a revoked member loses active access.

### M07 Live event updates

**Implementation window:** D17.

Notify the dashboard when capture history changes.

**Features:** Authenticated SSE stream, reconnect indicator and fallback polling.

**Rules and edge cases:** Send event IDs and change types, not full payloads. Client refetches through the normal authorized API. Heartbeats and cleanup prevent leaked connections. Recheck membership every 30 seconds and disconnect locally when a revocation is processed.

**Completion check:** A new event appears without reload; reconnect recovers via a list refresh.

### M08 Retention and data controls

**Implementation window:** D18 and D34.

Limit stored data and respect deletion immediately.

**Features:** Retention settings, expiry filtering, deletion, cleanup cursor and request quotas.

**Rules and edge cases:** Default retention is seven days. Bookmarks do not bypass expiry. Redact credential headers and configured sensitive JSON keys before persistence. Mark truncation or redaction visibly.

**Completion check:** Expired data is hidden even before TTL runs; jobs cannot replay it.

### M09 Provider verification

**Implementation window:** D20.

Check that a supported sender signed a message.

**Features:** GitHub HMAC SHA256 verifier and generic unverified mode.

**Rules and edge cases:** Store secrets encrypted with an operator-managed key and key version. Verify bounded original bytes before parsing. Reject invalid signed messages without storing their body.

**Completion check:** Known signed fixture passes; changed body, wrong secret and missing signature fail.

### M10 Team collaboration

**Implementation window:** D21 to D23.

Let a team coordinate debugging.

**Features:** One-time invitations, role editing, tags, bookmarks and plain-text comments.

**Rules and edge cases:** Invitation tokens are hashed, scoped, expire after 24 hours and can be accepted once. Comments are length-limited and inherit event expiry. Invites are copied links; email delivery is outside v1.0.

**Completion check:** Owner invites member; viewer cannot comment; expired invitation cannot be reused.

### M11 Audit history

**Implementation window:** D24.

Explain significant account and workspace changes.

**Features:** Actor, action, target ID, time, outcome and correlation ID.

**Rules and edge cases:** Record role changes, token rotations, destination changes, exports and replay requests. Never log credentials or event bodies. Audit retention is 30 days by default.

**Completion check:** A maintainer can identify who changed an inbox without seeing secret values.

### M12 Replay destinations

**Implementation window:** D25 to D26.

Restrict where the server can send test requests.

**Features:** Destination name, HTTPS URL, enabled state, operator allowlist and preview.

**Rules and edge cases:** No arbitrary URL on replay. Disallow URL credentials, redirects and unsafe resolved addresses. Revalidate all IPv4 and IPv6 results at execution and pin the approved connection address. Destination headers use a small allowlist.

**Completion check:** Loopback, private, link-local, metadata and DNS-rebinding cases are blocked in hosted mode.

### M13 Replay jobs and attempts

**Implementation window:** D27 to D29.

Send controlled copies and preserve delivery outcomes.

**Features:** Create job, status page, manual retry, cancellation and attempt list.

**Rules and edge cases:** Mongo job claims use atomic leases and fencing tokens. Dispatching jobs with an expired lease become unknown and require manual action; they are not resent automatically. Only queued jobs can be canceled reliably.

**Completion check:** Worker restart does not silently resend a request whose delivery may have started.

### M14 Payload comparison and fixtures

**Implementation window:** D31 to D32.

Turn useful captures into repeatable tests.

**Features:** Compare two JSON events, added or removed fields, redacted export and copy as cURL.

**Rules and edge cases:** Compare within one workspace and only live events. Mark arrays as order-sensitive. Export sanitized data only; cURL omits original signatures, credentials and capture tokens.

**Completion check:** A nested field change is visible and exported fixtures contain no configured secrets.

### M15 API tokens and reference

**Implementation window:** D33.

Allow developers to read inbox data from scripts.

**Features:** Named personal tokens, explicit workspace, read scopes, expiry, revocation and OpenAPI examples.

**Rules and edge cases:** Store only token hashes. Tokens cannot manage membership, secrets or replay. Default expiry is 30 days. Recheck active membership on use.

**Completion check:** A scoped token can list events; expired or revoked tokens fail.

### M16 Usage and health

**Implementation window:** D34 to D35.

Show whether the service is functioning within its limits.

**Features:** Recent capture counts, replay outcomes, storage estimates, job age and health endpoints.

**Rules and edge cases:** Separate process liveness from dependency readiness. Analytics labels are low-cardinality and never contain capture URLs or event bodies.

**Completion check:** A database outage makes readiness fail; worker lag is visible.

### M17 Deployment and recovery

**Implementation window:** D19 and D36 to D37.

Make local and hosted operation repeatable.

**Features:** Compose services, TLS proxy notes, secrets, backup, restore, upgrade and rollback instructions.

**Rules and edge cases:** Run API and worker separately; use persistent Mongo storage. Keep encryption keys with secure backups. Disable replay on backup restore until jobs are reconciled.

**Completion check:** A clean environment restores a backup and can read the expected synthetic event.

### M18 Public release and contribution

**Implementation window:** D10 and D38 to D40.

Make the project understandable and maintainable by others.

**Features:** README, license, contribution guide, fixtures, issue templates, release notes, demo and roadmap.

**Rules and edge cases:** Use real examples of shipped features. Label roadmap items clearly. Demo reset uses synthetic data only. No feature, usage or GHFind score claims without evidence.

**Completion check:** A tester completes install, capture, inspect and replay using documentation alone.

### Role permissions

| Operation | Owner | Member | Viewer |
|---|---|---|---|
| Inspect live events and compare payloads | Yes | Yes | Yes |
| Add tags comments and bookmarks | Yes | Yes | No |
| Export sanitized fixtures | Yes | Yes | No |
| Trigger replay to an enabled destination | Yes | Yes | No |
| Manage inbox configuration and destinations | Yes | No | No |
| Manage membership and workspace settings | Yes | No | No |
| View workspace audit history | Yes | No | No |
| Issue personal read tokens | Yes | Yes | Yes within current read access |

An API token never gains rights beyond the intersection of its scopes, its workspace and the owner's current membership. Object IDs are identifiers, not authorization.

## 5 Data model and API contracts

### Collections and relationships

Use UTC dates in storage and ISO 8601 timestamps in APIs. All workspace data carries workspaceId. Use ObjectId internally and serialize IDs as strings. Validate fields using shared schemas and explicit allowlists before persistence.

| Collection | Important fields | Index and lifecycle |
|---|---|---|
| users | emailNormalized passwordHash status recoveryCodeHashes | Unique email; never return hash fields |
| sessions | tokenHash userId csrfSecret expiresAt revokedAt | Unique tokenHash; TTL expiresAt plus explicit expiry checks |
| workspaces | name ownerId state createdAt | Owner reference; state active or deleting |
| memberships | workspaceId userId role | Unique workspaceId and userId |
| invitations | tokenHash workspaceId invitedEmail role expiresAt usedAt | Unique hash; atomic acceptance; TTL |
| inboxes | workspaceId name tokenHash encryptedToken enabled retentionDays verificationConfig | Unique capture token hash; workspace list index |
| events | workspaceId inboxId receivedAt method safeHeaders safeBody format signatureState expiresAt deletedAt tags | Compound workspace inbox receivedAt ID; separate TTL expiresAt |
| annotations | workspaceId eventId userId type text createdAt expiresAt | Event lookup; unique user bookmark per event; TTL |
| destinations | workspaceId name url encryptedHeaders enabled version | Workspace lookup; URL policy checked on every dispatch |
| replayJobs | workspaceId eventId destinationId requesterId idempotencyKey state runAfter lease fencingToken snapshot expiresAt | Unique workspace requester idempotencyKey; claim index state and runAfter |
| replayAttempts | workspaceId jobId attemptNo startedAt endedAt outcome status preview expiresAt | Unique jobId and attemptNo; TTL |
| apiTokens | tokenHash userId workspaceId scopes expiresAt revokedAt | Unique token hash; expiry checked on each use |
| auditEntries | workspaceId actorId action targetId result correlationId createdAt expiresAt | Workspace and createdAt; TTL |

Store an encrypted capture token only so authorized owners can retrieve its URL later; keep the token hash for lookup. Use authenticated encryption such as AES 256 GCM with a fresh nonce and key version. The encryption key belongs in runtime secrets, not Mongo or the repository. Display secrets only through owner-authorized actions and exclude them from normal list responses.

Persist redacted payloads only. For JSON, remove configured sensitive keys recursively before storing. Credential header values are omitted; safe header names can remain. Non-JSON bodies are not guaranteed to contain no sensitive text, so provide an inbox option to disable body capture and require synthetic data for the shared demo. Do not index or log full payloads.

### Replay state machine

```text
queued --> claimed --> dispatching --> succeeded
   |          |             +-------> failed
   |          |             +-------> unknown
   |          +--> queued if lease expires before dispatch
   +--> canceled
```

The worker marks dispatching before opening the outbound connection. Crash recovery requeues only a claimed job with no dispatch marker. An expired dispatching lease becomes unknown. A fencing token prevents a stale worker from overwriting a new claim. The attempt number and lease are durable. Mongo cannot atomically commit an HTTP side effect, so the design does not claim exactly-once delivery. Stable job IDs support receiver deduplication.

Creating the same replay with the same idempotency key returns the existing job. Reusing that key for different input returns 409. A retry after a terminal result is an explicit new job with parentJobId. Revalidate workspace membership, event expiry and destination version immediately before dispatch. Set job and attempt expiry no later than the source event expiry; annotations and stored replay snapshots follow the same data lifetime.

### API conventions

Management endpoints start with /api/v1. Browser sessions use cookies and CSRF protection. API tokens use Authorization Bearer and can call only their read-scoped endpoints. Capture URLs use their dedicated random token and do not accept management credentials. Lists return data and nextCursor; clients cannot submit raw Mongo queries.

Success responses use a data object. Errors use error.code, error.message and error.requestId. Use 400 for malformed input, 401 for missing identity, 403 for known forbidden actions, 404 for inaccessible object lookups, 409 for conflicts, 410 for disabled capture endpoints, 413 for large bodies, 415 for unsupported formats, 429 for rate limits and 503 for unavailable storage. Do not disclose whether another workspace's object exists.

### Endpoint inventory

| Method and route | Purpose and authorization |
|---|---|
| POST /auth/register | Accept bootstrap or invitation flow; closed public signup by default |
| POST /auth/login | Issue browser session after rate-limited credential verification |
| POST /auth/logout | Revoke current session; browser CSRF required |
| GET /auth/me | Return current user and active memberships |
| GET /auth/csrf | Return session-bound CSRF token for browser mutations |
| POST /auth/recover | Consume a one-time recovery code and change password |
| POST /workspaces | Signed-in user creates a workspace and owner membership |
| GET /workspaces | List current user's workspaces |
| PATCH /workspaces/:id | Owner updates workspace name or settings |
| POST /workspaces/:id/transfer | Owner atomically transfers ownership to an existing member |
| GET POST /workspaces/:id/inboxes | List inboxes or owner creates an inbox |
| GET PATCH DELETE /inboxes/:id | Read; owner changes or disables and queues deletion |
| POST /inboxes/:id/rotate-token | Owner rotates capture credentials |
| POST /inboxes/:id/verification | Owner sets or clears provider secret without returning it |
| ANY /capture/:token | Bounded GET HEAD POST PUT PATCH DELETE capture; OPTIONS handled separately |
| GET /inboxes/:id/events | Authorized filtered cursor list |
| GET DELETE /events/:id | Read live event; owner or member deletes it |
| GET /workspaces/:id/stream | Authorized SSE notifications; periodic membership checks |
| GET POST /workspaces/:id/invitations | Owner lists or creates one-time invitations |
| POST /invitations/accept | Signed-in matching address consumes invitation |
| PATCH DELETE /workspaces/:id/members/:userId | Owner changes role or revokes membership |
| POST DELETE /events/:id/bookmark | Owner or member adds or removes own bookmark |
| PATCH /events/:id/tags | Owner or member updates bounded tags |
| GET POST /events/:id/comments | Read comments; owner or member creates one |
| DELETE /comments/:id | Author or owner deletes comment within workspace |
| GET /workspaces/:id/audit | Owner reads paginated audit history |
| GET POST /workspaces/:id/destinations | Read allowed configuration; owner creates destination |
| PATCH DELETE /destinations/:id | Owner updates or disables destination |
| POST /events/:id/replays | Owner or member requests a job with destinationId and idempotency key |
| GET /replays/:id | Authorized member reads job and attempts |
| POST /replays/:id/cancel | Owner or requester cancels a queued job |
| POST /replays/:id/retry | Owner or member explicitly creates linked retry job |
| POST /events/compare | Read two live same-workspace JSON events |
| POST /events/:id/export | Owner or member receives sanitized JSON or cURL text |
| GET POST DELETE /tokens | Current user lists creates or revokes personal read tokens |
| GET /workspaces/:id/usage | Owner reads bounded usage and replay summaries |
| GET /health/live and /health/ready | Infrastructure liveness and dependency readiness |

All management paths in this inventory have the /api/v1 prefix. Capture and health paths are exceptions. Support GET, HEAD, POST, PUT, PATCH and DELETE explicitly on capture; reject TRACE and CONNECT. OPTIONS returns preflight metadata and does not create an event.

### Example contracts

```json
{
  "createInbox": {"name": "GitHub staging", "retentionDays": 7},
  "captureResponse": {"data": {"eventId": "0123456789abcdef01234567", "captured": true}},
  "createReplay": {"destinationId": "0123456789abcdef01234568"},
  "replayResponse": {"data": {"jobId": "0123456789abcdef01234569", "state": "queued"}},
  "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Request body exceeds the configured limit", "requestId": "d9291b26-40f2-4b1b-8fa9-6d11e790b6f5"}
}
```

Capture returns 201 after successful persistence; a HEAD response has no body. Replay creation returns 202 and a job location. Supply the replay idempotency key in the Idempotency-Key header. A repeated provider delivery remains a separate captured event in v1.0; display a provider delivery ID when available but do not silently deduplicate legitimate retries.

## 6 Operating defaults and quality requirements

### Initial configurable limits

These are proposed starting limits to validate during load testing, not measured capacity or industry requirements.

| Setting | Initial default |
|---|---|
| Inbound payload | 256 KiB uncompressed |
| Request list | 25 items with maximum 100 |
| Event retention | 7 days with owner choices of 1 7 or 30 |
| Inboxes per workspace | 10 |
| Capture rate | 60 requests per minute per inbox and a deployment-wide ceiling |
| Events per workspace | 10000 live records then reject new capture with a clear quota error |
| Replay timeout | 10 seconds total |
| Replay response preview | 16 KiB after redaction |
| Replay concurrency | 2 globally and 1 per destination |
| Replay attempt policy | One attempt per job with explicit manual retry |
| Session expiry | 24 hours absolute plus revocation on recovery |
| API token expiry | 30 days |
| Audit retention | 30 days |

At first use a single API process and in-process rate limiter; restart resets counters. Treat that as a beta limitation and configure a reverse-proxy global ceiling before public hosting. Enforce storage quotas using a documented conservative counter with reconciliation; reserve capacity atomically and release on failed insertion. Quotas may reject early after a crash until reconciliation. Do not promise exact billing-grade counters.

### Replay network policy

Use an operator-controlled hostname allowlist in addition to workspace destination records. Hosted destinations require HTTPS and allowed ports. Resolve and inspect all IPv4 and IPv6 addresses, block private and special ranges, and pin the vetted address for the connection while preserving TLS hostname validation. Reject redirects and repeat validation on every attempt. Do not accept a user-supplied Host header, proxy setting or URL credential. A local-only deployment may enable a clearly separate loopback testing mode; it is disabled and unavailable in the hosted demo.

OWASP recommends allowlisting and careful network validation for server-side outbound requests. Follow its SSRF prevention guidance when implementing this module. Source: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

### Test plan

- Unit tests cover schemas, redaction, signature verification, cursors and replay state transitions.
- API tests cover session lifecycle, workspace isolation, role enforcement, invitation races, limits and expired records.
- Browser tests cover onboarding, capture, search, team collaboration, sanitized export and replay status.
- Worker tests cover a crash before dispatch, an expired dispatching lease, destination changes, stale workers and event deletion.
- Operational tests cover database failure, clean install, backup restore and a failed release rollback.
- Accessibility checks cover keyboard navigation, focus handling, readable contrast, form labels and live-update announcements.

Run the checks relevant to each change immediately. CI always runs build, type checks and the fast test suite; run browser and replay integration suites before milestone releases.

### Performance and observability

For a controlled test on a recorded environment, target capture acknowledgement p95 below 500 ms and list responses p95 below 300 ms at 10 requests per second with 10000 sample events. These are test goals, not guarantees. Record hardware, database location, dataset size, concurrency and observed results. Optimize indexes and bounded queries before raising quotas.

Logs include request ID, route template, duration, status and safe workspace identifiers. Never log request bodies, password fields, bearer tokens, session cookies, verification secrets or capture URL tokens. Track rejected captures, job age and unknown replay outcomes. Health endpoints return no secrets.

### Deployment and recovery approach

Use Compose for self-hosting: reverse proxy, a Next.js frontend server built with next build and run with next start or standalone output, Express API, worker and Mongo with a persistent volume. The frontend runs as a separate Node.js service. Hosted environments need HTTPS, backup storage, runtime secrets and an operator allowlist for replay. Validate environment configuration at startup. Use the Node 24 LTS baseline and a pinned container image revision where practical.

Back up data and encrypted-secret keys through separate controlled procedures. Document that backups can retain data beyond live TTL until backup expiry. On restore, disable outbound replay, reconcile queued and dispatching records, verify keys and memberships, then enable the worker deliberately. Use backward-compatible schema changes in v1.0; maintain a migration version and test the prior release against restored data before rollback.

## 7 Forty day ordered backlog

Every row below is a task that can become a GitHub issue or a checklist item. The listed day prerequisites must be complete before dependent work starts. The task suffix gives the recommended order within the day. The day's acceptance check covers all three tasks.

For each day, allocate roughly three to four hours for implementation and one to two hours for checks, documentation and review. Carry unfinished work forward instead of making empty commits to preserve a daily streak. D40 depends on both the D38 complete-journey work and the D39 release candidate, even though its immediate predecessor label is D39.

### Days 1 to 10 Build the local tool

#### Day 01 Product contract and repository

Prerequisite: None. Modules: M01 M18. Planned effort: 5 to 6 hours.

- [x] **D01.1** Write the target user, first capture journey, scope boundaries and four milestone issues. [Brief and milestone issue evidence](PROJECT_BRIEF.md).

- [x] **D01.2** Create the public repository structure, README skeleton, license choice and task labels. [Repository guide](../README.md) and [task labels](../.github/README.md).

- [x] **D01.3** Pin the runtime and package manager; confirm library compatibility and commit the lockfile. [Toolchain and dependency evidence](TOOLCHAIN.md).

**Acceptance:** A developer can identify the first release scope and run the repository bootstrap command.

#### Day 02 Local application skeleton

Prerequisite: D01. Modules: M01. Planned effort: 5 to 6 hours.

- [x] **D02.1** Create the Next.js App Router shell with pages, layouts and a Client Component provider boundary, plus Express startup, shared TypeScript configuration and environment schemas. [Local development and verification](LOCAL_DEVELOPMENT.md).

- [x] **D02.2** Connect Mongo locally and expose health routes without printing connection credentials. [Local MongoDB and health evidence](MONGODB_LOCAL.md).

- [x] **D02.3** Add ESLint, typecheck, Next.js and Express build scripts, same-origin development API routing and sample environment configuration with placeholders. [Tooling, routing and clean-start evidence](LOCAL_DEVELOPMENT.md).

**Acceptance:** Next.js frontend and Express API start from a clean checkout; direct frontend navigation and same-origin API requests work, and missing required configuration fails clearly.

#### Day 03 Contracts and automated checks

Prerequisite: D02. Modules: M01. Planned effort: 5 to 6 hours.

- [x] **D03.1** Define shared error, identifier and pagination contracts and request correlation IDs. [Contract and correlation evidence](API_CONTRACTS.md).

- [x] **D03.2** Add unit and API test harnesses with disposable Mongo test data. [Harness and disposable-data evidence](TESTING.md).

- [x] **D03.3** Create PR automation for installation, ESLint, type checks, tests, the Next.js production build and backend builds. [CI and failure/correction evidence](CI.md).

**Acceptance:** A deliberately invalid contract test fails in CI and passes after the correction.

#### Day 04 Local workspace and inbox model

Prerequisite: D03. Modules: M02. Planned effort: 5 to 6 hours.

- [x] **D04.1** Create workspace and inbox schemas with timestamps and explicit validation. [Metadata model and validation evidence](DATA_MODELS.md).

- [x] **D04.2** Implement random capture token generation, hashed lookup and encrypted owner retrieval. [Token security and verification evidence](CAPTURE_TOKENS.md).

- [x] **D04.3** Add local workspace bootstrap and inbox creation service without public signup. [Local operator flow and service evidence](LOCAL_INBOX.md).

**Acceptance:** A created inbox has a valid token and list responses omit secret values.

#### Day 05 Inbox management interface

Prerequisite: D04. Modules: M02. Planned effort: 5 to 6 hours.

- [ ] **D05.1** Build inbox list, create form, detail page and empty states.

- [ ] **D05.2** Implement rename, disable and capture-token rotation services.

- [ ] **D05.3** Test validation, old-token invalidation and disabled-inbox responses.

**Acceptance:** A maintainer creates and disables an inbox; the old token fails after rotation.

#### Day 06 Bounded capture endpoint

Prerequisite: D05. Modules: M03. Planned effort: 5 to 6 hours.

- [ ] **D06.1** Implement explicitly supported HTTP methods and bounded raw-byte collection.

- [ ] **D06.2** Normalize safe metadata and parse JSON, form and text payloads without executing content.

- [ ] **D06.3** Reject oversized, binary and compressed bodies with documented status codes.

**Acceptance:** Synthetic JSON and text samples capture; an oversized request returns 413 without partial storage.

#### Day 07 Redaction and durable capture

Prerequisite: D06. Modules: M03 M08. Planned effort: 5 to 6 hours.

- [ ] **D07.1** Implement credential-header omission and recursive configured JSON-key redaction.

- [ ] **D07.2** Persist sanitized events before acknowledging capture and attach expiry and parse flags.

- [ ] **D07.3** Test database failure, hostile HTML content and redaction on nested fixture data.

**Acceptance:** Stored samples contain redacted test secrets; database failure returns 503 rather than success.

#### Day 08 Event list and pagination

Prerequisite: D07. Modules: M04. Planned effort: 5 to 6 hours.

- [ ] **D08.1** Build inbox event list with loading, error and empty states.

- [ ] **D08.2** Implement stable cursor pagination and the inbox receivedAt index.

- [ ] **D08.3** Test first, next and final pages with generated fixture events.

**Acceptance:** A 60-event fixture can be browsed without missing or duplicated records in stable data.

#### Day 09 Event inspection and deletion

Prerequisite: D08. Modules: M04 M08. Planned effort: 5 to 6 hours.

- [ ] **D09.1** Build metadata, formatted JSON and sanitized-text detail views.

- [ ] **D09.2** Implement event soft deletion and default exclusion of deleted data.

- [ ] **D09.3** Add safe rendering, keyboard navigation and invalid-JSON regression tests.

**Acceptance:** A tester inspects a message and deletes it; HTML is shown as text and deleted details disappear.

#### Day 10 Local preview release

Prerequisite: D09. Modules: M18. Planned effort: 5 to 6 hours.

- [ ] **D10.1** Document clean setup, first sample request, known limitations and local-only operation.

- [ ] **D10.2** Run the capture-to-inspect browser journey and record a short synthetic-data demonstration.

- [ ] **D10.3** Fix preview blockers and publish the v0.1 release notes and tag.

**Acceptance:** A fresh tester completes the local sample workflow using only the README.

### Days 11 to 20 Secure the beta

#### Day 11 User identity and bootstrap

Prerequisite: D10. Modules: M05. Planned effort: 5 to 6 hours.

- [ ] **D11.1** Create user schema, normalized email uniqueness and maintained password hashing.

- [ ] **D11.2** Implement operator bootstrap registration and close unrestricted signup.

- [ ] **D11.3** Test duplicate users, invalid passwords and bounded login attempts.

**Acceptance:** Only the documented bootstrap flow creates the first user; password hashes never leave the server.

#### Day 12 Browser sessions and login

Prerequisite: D11. Modules: M05. Planned effort: 5 to 6 hours.

- [ ] **D12.1** Implement random database-backed sessions with hashed lookup and absolute expiry.

- [ ] **D12.2** Build login, logout, current-user routing and session-expired UI.

- [ ] **D12.3** Apply cookie flags, origin checks and CSRF protection to browser mutations.

**Acceptance:** Login persists across refresh; logout revokes the session and a CSRF-less mutation fails.

#### Day 13 Account recovery and isolation tests

Prerequisite: D12. Modules: M05 M06. Planned effort: 5 to 6 hours.

- [ ] **D13.1** Generate one-time recovery codes and store only their hashes.

- [ ] **D13.2** Implement password recovery with generic failures, throttling and full session revocation.

- [ ] **D13.3** Add identity fixtures for two users and prove unauthorized account operations are denied.

**Acceptance:** A recovery code works once and old sessions stop working after password recovery.

#### Day 14 Workspace ownership enforcement

Prerequisite: D13. Modules: M06. Planned effort: 5 to 6 hours.

- [ ] **D14.1** Create memberships and bind the initial owner to the workspace.

- [ ] **D14.2** Apply membership and role checks to every existing management query and mutation.

- [ ] **D14.3** Add cross-workspace API tests including guessed inbox and event IDs.

**Acceptance:** User A cannot list, read, delete or rotate credentials for user B's workspace.

#### Day 15 Workspace settings and inbox policy

Prerequisite: D14. Modules: M02 M08. Planned effort: 5 to 6 hours.

- [ ] **D15.1** Build workspace switching, settings and inbox retention selection.

- [ ] **D15.2** Require owner permissions for inbox configuration and token retrieval.

- [ ] **D15.3** Document how changed retention applies to future and existing events; implement a batch update for shortening it.

**Acceptance:** An owner shortens retention and previously captured expired records immediately become inaccessible.

#### Day 16 Filtering and search experience

Prerequisite: D15. Modules: M04. Planned effort: 5 to 6 hours.

- [ ] **D16.1** Add method, date range, inbox and provider-event-type filters.

- [ ] **D16.2** Synchronize filters with browser URL state and cursor reset rules.

- [ ] **D16.3** Test invalid ranges, no-result states and indexed query behaviour.

**Acceptance:** A shared application URL restores filters for an authorized teammate without exposing credentials.

#### Day 17 Live updates and reconnect

Prerequisite: D16. Modules: M07. Planned effort: 5 to 6 hours.

- [ ] **D17.1** Implement session-authenticated SSE with heartbeat and workspace scoping.

- [ ] **D17.2** Publish lightweight event-ID notices and refetch through the normal API.

- [ ] **D17.3** Add reconnect status, polling fallback and revocation checks for open streams.

**Acceptance:** New events appear live and a revoked member stops receiving notifications within the documented check interval.

#### Day 18 Expiry and cleanup worker

Prerequisite: D17. Modules: M08 M17. Planned effort: 5 to 6 hours.

- [ ] **D18.1** Start the separate Node worker and add TTL indexes plus batched dependent-record cleanup.

- [ ] **D18.2** Enforce expiry and deletion in reads, filters and live event resolution.

- [ ] **D18.3** Test expiry before physical TTL deletion and worker restart during cleanup.

**Acceptance:** Expired data cannot be fetched even while its database record still exists.

#### Day 19 Private beta deployment and buffer

Prerequisite: D18. Modules: M17. Planned effort: 5 to 6 hours.

- [ ] **D19.1** Deploy the authenticated app to an invited-test environment with HTTPS and persistent Mongo.

- [ ] **D19.2** Configure proxy capture ceilings, protected logs and startup environment checks.

- [ ] **D19.3** Use remaining time to fix authorization, expiry and installation regressions.

**Acceptance:** An invited tester captures a synthetic event; anonymous users cannot inspect it.

#### Day 20 GitHub signatures and beta release

Prerequisite: D19. Modules: M09 M18. Planned effort: 5 to 6 hours.

- [ ] **D20.1** Implement encrypted inbox verification secrets and raw-body HMAC validation.

- [ ] **D20.2** Test known signed fixtures, altered bodies, missing signatures and secret rotation.

- [ ] **D20.3** Document the GitHub integration and publish authenticated beta v0.2.

**Acceptance:** A real configured GitHub test delivery is verified and a modified fixture is rejected.

### Days 21 to 30 Add teamwork and replay

#### Day 21 Invitations and role services

Prerequisite: D20. Modules: M06 M10. Planned effort: 5 to 6 hours.

- [ ] **D21.1** Add owner, member and viewer role rules to a central authorization service.

- [ ] **D21.2** Implement hashed one-time invitations, matching-address acceptance and revocation.

- [ ] **D21.3** Test invitation expiry, simultaneous acceptance attempts and role escalation.

**Acceptance:** An invitation can be consumed once by the intended signed-in user and cannot grant owner rights.

#### Day 22 Team management interface

Prerequisite: D21. Modules: M06 M10. Planned effort: 5 to 6 hours.

- [ ] **D22.1** Build members list, invitation creation, role editing and removal screens.

- [ ] **D22.2** Implement atomic owner transfer while preventing removal of the last owner.

- [ ] **D22.3** Exercise owner, member and viewer journeys in the browser.

**Acceptance:** A viewer cannot mutate data and a removed member immediately fails new API calls.

#### Day 23 Tags bookmarks and comments

Prerequisite: D22. Modules: M10. Planned effort: 5 to 6 hours.

- [ ] **D23.1** Add bounded tags, user bookmarks and plain-text event comments.

- [ ] **D23.2** Implement author or owner comment deletion and appropriate role checks.

- [ ] **D23.3** Apply event-expiry checks to annotations and cover rendering and permission edge cases.

**Acceptance:** Members collaborate on an event while viewers remain read-only; expired events reveal no comments.

#### Day 24 Audit history

Prerequisite: D23. Modules: M11. Planned effort: 5 to 6 hours.

- [ ] **D24.1** Record safe audit events for configuration, role, credential, export and replay actions.

- [ ] **D24.2** Build owner-only audit list with pagination and correlation IDs.

- [ ] **D24.3** Test that secrets and captured bodies are absent from audit records.

**Acceptance:** The owner can identify who rotated an inbox token without seeing the token in the audit entry.

#### Day 25 Destination configuration

Prerequisite: D24. Modules: M12. Planned effort: 5 to 6 hours.

- [ ] **D25.1** Define destination schema, encrypted permitted headers and operator hostname allowlist.

- [ ] **D25.2** Implement owner-only destination create, update and disable operations.

- [ ] **D25.3** Build a destination settings UI explaining that replay sends a sanitized test copy.

**Acceptance:** An owner saves an allowed HTTPS destination; an unapproved hostname is rejected.

#### Day 26 Outbound request protections

Prerequisite: D25. Modules: M12. Planned effort: 5 to 6 hours.

- [ ] **D26.1** Implement URL validation, safe address classification and vetted-address connection pinning.

- [ ] **D26.2** Disable redirects, unsafe headers, URL credentials and hosted access to internal addresses.

- [ ] **D26.3** Test IPv4, IPv6, DNS rebinding, redirect and timeout cases against controlled receivers.

**Acceptance:** Outbound tests demonstrate that hosted replay cannot contact loopback or private-network targets.

#### Day 27 Replay job persistence

Prerequisite: D26. Modules: M13. Planned effort: 5 to 6 hours.

- [ ] **D27.1** Create durable jobs, attempt records, unique idempotency keys and fencing tokens.

- [ ] **D27.2** Implement atomic claim, lease expiry and pre-dispatch authorization checks.

- [ ] **D27.3** Test duplicate submissions and crash recovery before any outbound connection.

**Acceptance:** Repeating a replay submission with the same key returns one job and conflicting input returns 409.

#### Day 28 Replay worker and inspection

Prerequisite: D27. Modules: M13. Planned effort: 5 to 6 hours.

- [ ] **D28.1** Dispatch one bounded sanitized request per job using the approved destination policy.

- [ ] **D28.2** Persist response status, timing, redacted preview and terminal outcome.

- [ ] **D28.3** Build replay preview, confirmation and result screens; omit original provider signatures.

**Acceptance:** A synthetic request reaches the controlled receiver and its result appears in the event history.

#### Day 29 Replay failure recovery and buffer

Prerequisite: D28. Modules: M13. Planned effort: 5 to 6 hours.

- [ ] **D29.1** Implement queued cancellation and explicit linked manual retry.

- [ ] **D29.2** Handle expired dispatching leases as unknown and block stale-worker state overwrites.

- [ ] **D29.3** Test crash-after-send, event deletion, revoked membership and disabled destination before dispatch; fix blockers.

**Acceptance:** An uncertain prior delivery is shown as unknown and never resent automatically.

#### Day 30 Team and replay beta release

Prerequisite: D29. Modules: M18. Planned effort: 5 to 6 hours.

- [ ] **D30.1** Run the full owner-member-viewer and controlled replay browser journeys.

- [ ] **D30.2** Document replay semantics, signing limits, destination policy and troubleshooting.

- [ ] **D30.3** Collect beta feedback, fix release blockers and tag v0.3.

**Acceptance:** An invited team can debug and replay a sample using documentation without access leaks.

### Days 31 to 40 Prepare the public release

#### Day 31 Payload comparison

Prerequisite: D30. Modules: M14. Planned effort: 5 to 6 hours.

- [ ] **D31.1** Implement JSON comparison for two accessible live events in one workspace.

- [ ] **D31.2** Build added, removed and changed-field views with clear array ordering.

- [ ] **D31.3** Test nested values, large bounded JSON, redacted fields and non-JSON rejection.

**Acceptance:** Two synthetic payload versions produce an accurate readable difference view.

#### Day 32 Fixture export and cURL copy

Prerequisite: D31. Modules: M14. Planned effort: 5 to 6 hours.

- [ ] **D32.1** Export sanitized JSON fixtures with safe metadata and format version.

- [ ] **D32.2** Generate shell-quoted cURL text with editable target placeholders and safe headers.

- [ ] **D32.3** Test export permissions, secret omission, quotes, newlines and hostile shell characters.

**Acceptance:** A generated command handles fixture strings safely and never embeds a capture token or original signature.

#### Day 33 Personal read tokens and API reference

Prerequisite: D32. Modules: M15. Planned effort: 5 to 6 hours.

- [ ] **D33.1** Implement hashed read tokens with workspace scopes, expiry and revocation.

- [ ] **D33.2** Build token management UI with one-time display and current-membership checks.

- [ ] **D33.3** Complete OpenAPI schemas and examples and test forbidden write and cross-workspace access.

**Acceptance:** A token reads only its permitted workspace and loses access after revocation or member removal.

#### Day 34 Quotas and usage tracking

Prerequisite: D33. Modules: M08 M16. Planned effort: 5 to 6 hours.

- [ ] **D34.1** Implement atomic quota reservations, cleanup reconciliation and bounded capture limits.

- [ ] **D34.2** Add workspace usage summary with approximate storage and clear limit states.

- [ ] **D34.3** Test concurrent capture near quota, failed inserts and worker restarts.

**Acceptance:** Concurrent requests cannot silently bypass the configured quota; conservative over-counts are reconciled.

#### Day 35 Service metrics and query performance

Prerequisite: D34. Modules: M16. Planned effort: 5 to 6 hours.

- [ ] **D35.1** Add readiness checks, capture/replay summaries and worker-lag visibility.

- [ ] **D35.2** Generate a fixed sample dataset and measure target list and capture latency.

- [ ] **D35.3** Review indexes and payload sizes; record observed results and fix measured bottlenecks.

**Acceptance:** Performance notes identify environment and p95 results; dependency failure changes readiness status.

#### Day 36 Repeatable self hosting

Prerequisite: D35. Modules: M17. Planned effort: 5 to 6 hours.

- [ ] **D36.1** Complete Compose services for the Next.js frontend, Express API, worker and Mongo, including volumes, reverse-proxy routes, unbuffered SSE and production environment examples.

- [ ] **D36.2** Document first-owner creation, secrets, destination allowlist and image version selection.

- [ ] **D36.3** Run the install from a clean environment and repair missing steps.

**Acceptance:** Another developer starts a private instance and captures an event without undocumented configuration.

#### Day 37 Backup restore and upgrade drill

Prerequisite: D36. Modules: M17. Planned effort: 5 to 6 hours.

- [ ] **D37.1** Document and exercise database backup plus separate encryption-key recovery.

- [ ] **D37.2** Restore into an isolated environment with outbound replay disabled and reconcile jobs.

- [ ] **D37.3** Test a backward-compatible upgrade and rollback using the previous beta release.

**Acceptance:** Restored synthetic records are readable and no restored job is automatically delivered.

#### Day 38 Public documentation accessibility and complete journeys

Prerequisite: D37. Modules: M04 M18. Planned effort: 5 to 6 hours.

- [ ] **D38.1** Complete public setup, architecture, API and contribution docs using the earlier release notes and examples.

- [ ] **D38.2** Run keyboard, focus, contrast and form-label checks plus the full capture, isolation, compare, export and replay browser suites.

- [ ] **D38.3** Create a synthetic-data demo, ask a fresh tester to follow the docs and fix remaining user-facing defects.

**Acceptance:** A fresh tester completes the core journeys and key screens work without a mouse.

#### Day 39 Release candidate and buffer

Prerequisite: D38. Modules: M17 M18. Planned effort: 5 to 6 hours.

- [ ] **D39.1** Freeze new features and run clean-install, build, regression and dependency checks.

- [ ] **D39.2** Recheck logs, default access, replay policy, retention and backup instructions.

- [ ] **D39.3** Resolve blockers and prepare known limitations, release notes and a tagged candidate.

**Acceptance:** No unresolved blocker affects isolation, capture correctness, replay controls or recovery.

#### Day 40 Version one release and feedback intake

Prerequisite: D39. Modules: M18. Planned effort: 5 to 6 hours.

- [ ] **D40.1** Publish the approved v1.0 code release, install instructions and synthetic demonstration.

- [ ] **D40.2** Invite initial users to try a specific workflow and record actionable feedback.

- [ ] **D40.3** Review project evidence and fresh GHFind category scores when available; prioritize the next maintenance issues.

**Acceptance:** A public reader can install v1.0 and complete the core workflow; follow-up issues describe real needs.

## 8 Delivery workflow and release gates

### Picking the next task

1. Find the earliest unfinished day whose prerequisites are complete.
2. Select its next task ID and link the corresponding module specification.
3. State the observable result and relevant acceptance check in the issue.
4. Implement the smallest complete change that achieves that result.
5. Run relevant checks, update changed behaviour in the docs, and request review.
6. Merge only after evidence supports completion; mark the task complete and move to the next dependency.

Use board states Backlog, Ready, In progress, In review, Blocked and Done. Keep one main implementation task in progress per developer. A blocked issue names the missing dependency and the next action. Labels can identify api, web, worker, docs, tests, bug and the milestone; labels themselves are not score activity.

### Definition of done for every task

- The acceptance check is demonstrated, not merely described.
- Inputs, failures and permission boundaries affected by the change are handled.
- Relevant tests and the normal build pass.
- The interface includes appropriate loading, empty and error states when applicable.
- Documentation and examples match changed behaviour.
- Review feedback is addressed and actual authorship is preserved.
- No secrets, real captured data or local configuration are added to the public repository.

### Milestone release gates

| Release | Evidence required |
|---|---|
| v0.1 | Clean local setup and capture inspect delete journey |
| v0.2 | Authentication, cross-workspace denial, expiry and signed GitHub fixture checks |
| v0.3 | Role matrix, outbound protection tests and crash-aware replay outcomes |
| v1.0 | Complete browser journeys, documented self-hosting, restore drill and usable public examples |

Do not open an incomplete local preview to unrestricted hosted traffic. A release gate is engineering completion evidence; it does not create an additional permission requirement for routine development.

### Issue template

```text
Task ID and title
Module and prerequisite IDs
User problem
Expected result
Implementation scope
Acceptance checks
Verification evidence
Documentation changes
```

### Pull request template

```text
Problem and resulting behaviour
Related task IDs
What changed
How it was checked
Permission or data-model changes
Screenshots if behaviour is visual
Known limitations and follow-up issue links
```

### Suggested project scripts

```text
dev              Start Next.js frontend and Express API for development
dev:worker       Start the background worker
build            Run the Next.js production build and backend builds
start:web        Run the built Next.js frontend service
lint             Run ESLint explicitly across application packages
typecheck        Check all TypeScript packages
test             Run fast unit and API checks
test:e2e         Run browser journeys
test:replay      Run worker and controlled receiver tests
seed:demo        Create synthetic local demonstration data
db:reconcile     Rebuild conservative quotas and cleanup state
```

Define these scripts during implementation; the names above are the proposed developer interface, not commands available in a created application today.

## 9 Public project growth and score tracking

Use one useful project to build a public engineering record. GHFind evaluates public evidence; the development plan cannot guarantee a score or replace genuine audience adoption.

| Category | Work in this plan | What remains outside task completion |
|---|---|---|
| Original and led projects | Working application, tests, documentation, attribution and releases | Recognition and adoption develop over time |
| Contribution quality | Real issues, useful PRs, review and merged changes | Actions count for the user who performs them |
| Activity authenticity | Continued development, investigation and maintenance | Empty daily commits add no useful evidence |
| Ecosystem impact | Useful popular project maintenance and relevant upstream fixes | A small project may have little qualifying reach |
| Community influence | Tutorials, helpful responses and welcoming contribution paths | Genuine followers cannot be guaranteed |
| Account maturity | Continued work using the existing account | Account age and active years take time |

Keep client and proprietary work private. A team member's PR does not automatically become a PR authored by empiricinfotech. Track repository adoption and individual contribution history separately. Current scoring may also recognize attributable leadership, but inspect its evidence before assuming credit.

At baseline and each release, save scan date, scoring release, historical or fresh status, six category scores, actual deductions and total. Add links to important merged work and releases. Investigate changed rules or incomplete data before interpreting a lower number as poorer development.

Ask early users for concrete feedback: Could you install it? Did a sample event appear? Was a field missing? Did the replay result make sense? Turn confirmed problems into issues. Publish tutorials about working features and fix upstream library problems when that work genuinely supports the project.

## 10 Later opportunities and references

### Features to consider after version one

- Additional provider signature verifiers with original-byte test fixtures.
- A maintained CLI for local inspection and fixture export.
- More advanced JSON search after measuring query cost and data exposure.
- Shared live-update fan-out and distributed rate limits for multiple API instances.
- Automatic retries only after defining destination idempotency and failure semantics.
- Secure optional raw retention only with a separate threat model, access policy and storage design.
- Email invitations and account recovery after selecting and configuring a mail provider.
- Integration libraries and SDKs driven by real users' needs.

### Terms used in this document

Webhook: an HTTP message sent when an event occurs. Inbox: a named endpoint and capture history. Workspace: a team boundary. Replay: a sanitized test copy sent to a configured destination. HMAC: a keyed signature used to check authenticity. TTL: database time-to-live cleanup. SSE: a persistent one-way server-to-browser event stream. Idempotency key: an identifier used to recognize a repeated submission. Lease: temporary ownership of a job. SSRF: misuse of a server's outbound network access.

### Primary references

These sources support the platform facts and design constraints. Module choices, limits, estimates and task sequencing are proposed decisions for this project.

- Node.js release status: https://nodejs.org/en/about/previous-releases
- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js self-hosting and environment configuration: https://nextjs.org/docs/app/guides/self-hosting
- GitHub webhook testing: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks
- GitHub signature validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- MongoDB TTL behaviour: https://www.mongodb.com/docs/manual/core/index-ttl/
- OWASP outbound-request protection: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- GHFind methodology: https://ghfind.com/en/methodology
- GHFind scoring source: https://github.com/hikariming/ghfind/blob/main/src/lib/score.ts
- GitHub account attribution: https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts

Reference review date: 21 October 2026. Recheck current framework support and scoring behaviour before relying on a later release.

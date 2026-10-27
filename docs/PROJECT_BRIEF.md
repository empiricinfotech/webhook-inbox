# Empiric Webhook Inbox: project brief

Task: **D01.1**. Planning baseline: [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md), version 1.1, 21 October 2026, especially sections 1, 2, 3, 7 and 8.

This brief defines the product contract and four future release outcomes. D01.2 added the repository layout, README, MIT license and task labels; D01.3 added the pinned toolchain, dependency manifests and lockfile. D02.1 adds the Next.js overview/setup shell and separate Express startup with shared TypeScript/environment schemas. D02.2 adds a local MongoDB connection and safe liveness/readiness routes. D02.3 adds checked lint/typecheck/build commands, same-origin development management routing and placeholder environment files. D03.1 defines shared identifiers, pagination and safe errors with generated request correlation IDs. D03.2 provides unit/API test harnesses and disposable synthetic Mongo data. The sample capture flow and releases are not implemented or verified yet. Repository initialization alone did not complete D01.1.

## Problem and intended outcome

Developers integrating a webhook provider need to establish whether an event arrived, inspect what it contained and reproduce an integration problem. Scattered logs make that evidence difficult to find or share with a teammate.

Empiric Webhook Inbox will provide a self-hostable debugging inbox: receive a message, persist sanitized debugging evidence and make it inspectable. Later releases add team access, comparison, safe exports and controlled replay of a sanitized test copy. A successful capture acknowledges storage, not processing by another business application.

## Primary users and practical use cases

| User | Practical use case | First useful outcome |
|---|---|---|
| MERN developer at a small agency | Check a GitHub staging integration before involving a business system | Find a synthetic issue event by its returned event ID and inspect its safe body |
| Integration engineer | Diagnose delivery metadata or a changed provider payload | Inspect timestamps/method/content type and, from v1.0, compare two accessible JSON events |
| QA tester | Reproduce a reported integration defect using synthetic data | Inspect and delete a local example; from v1.0, export a sanitized fixture |
| Small development team | Discuss an event and test a receiver without sharing raw credentials | From v0.3, use roles, annotations and a configured replay destination |

The first-release user is a single maintainer working locally. Hosted testers arrive only with v0.2 access controls; team collaboration and replay arrive in v0.3.

## First successful capture journey

This is a future v0.1 acceptance scenario, not a command or feature available today.

1. A maintainer follows the eventual local setup instructions, starts the stack and creates a local workspace and an inbox named **GitHub staging**.
2. The application displays an unguessable URL under **/capture/:token**. The maintainer keeps the token private.
3. The maintainer sends a synthetic JSON message to that URL. For example: `{"action":"opened","issue":{"number":1,"title":"Synthetic capture check"}}`. This generic sample is unverified; it does not claim to be an authenticated GitHub delivery.
4. Express bounds the original request, parses supported content, omits credential headers, redacts configured sensitive JSON keys and persists the sanitized event in MongoDB. It returns **201** with `data.eventId` and `data.captured: true` only after storage succeeds.
5. The maintainer refreshes the request list and opens that same event ID. The detail shows received time, HTTP method, content type, signature state, safe headers and safe body. Redaction or parsing indicators remain visible; HTML is displayed as text.
6. The maintainer deletes the sample. It disappears from normal lists and its detail can no longer be read.

**Observable success:** the response ID, list entry and inspected event agree, the safe content is understandable and deletion hides it. No receiver dispatch or replay is needed to complete this journey. Live SSE is later v0.2 work; a manual refresh is sufficient in v0.1.

**Failure contract:** a missing inbox returns 404; a disabled inbox returns 410; a body above the initial 256 KiB limit returns 413 without partial storage; unavailable storage returns 503. Unsupported binary or compressed content is rejected. The dashboard must not report capture success for these failures. For generic inboxes, signature state explicitly says authenticity was not verified.

## Included functionality and scope boundaries

### Initial release: v0.1, local development only

Include local workspace/inbox setup, inbox creation/rename/disable/token rotation, bounded explicitly supported capture methods, JSON/text/form parsing, safe metadata and credential redaction, sanitized persistence, paginated event listing, readable detail, deletion and clean local setup documentation. GET/HEAD capture metadata; OPTIONS is preflight only. The capture receiver does not forward events.

The v0.1 release must demonstrate the local capture/inspect/delete journey. Accounts, hosted access, role enforcement, live updates, provider verification, collaboration, comparison, export, API tokens and replay are later milestones. Do not expose this unauthenticated preview to unrestricted hosted traffic.

### Later work within v1.0

- **v0.2:** revocable cookie sessions, invite-only identity bootstrap, workspace ownership/isolation, filters, live notices, retention/expiry enforcement, private HTTPS beta and original-byte GitHub signature verification.
- **v0.3:** owner/member/viewer roles, one-time invitations, annotations, audit history, approved destinations, protected outbound dispatch and durable replay outcomes.
- **v1.0:** same-workspace JSON comparison, sanitized fixtures/cURL, scoped read tokens/OpenAPI, quotas/usage/health, performance evidence, documented self-hosting, backup/restore/upgrade, accessibility and complete-journey release verification.

### Explicitly outside the first 40 development days

Billing/subscriptions, AI summaries, mobile apps, Kubernetes, unlimited retention, anonymous public sharing, arbitrary JavaScript transformations, a raw payload vault, exact byte-for-byte raw replay, guaranteed exactly-once delivery, automatic replay retries, enterprise SSO and a custom localhost tunnel are excluded. Email invitation delivery, additional provider verifiers, SDKs and scale-out coordination are later opportunities.

Client/proprietary code and real customer capture data are outside the public repository and demonstration scope. Public source does not make hosted inbox data public. Screenshots and demo captures use synthetic data.

Replay sends stored sanitized content only to an explicitly configured, operator-approved destination. It does not accept an arbitrary URL or forward an original provider signature as valid authentication for modified content. One job gets one dispatch attempt; a delivery that may have started becomes **unknown** after a crash and is never silently resent. Expired/deleted events are blocked at read/export/replay time, independently of background TTL cleanup.

## Assumptions and architecture decisions

- Follow the current version 1.1 plan: TypeScript, Next.js with React and App Router, a separate Express API and MongoDB/Mongoose. Express owns authorization, capture, persistence and replay; UI guards do not authorize API access.
- The Next.js dashboard calls the same-origin **/api/v1** management API. Providers send capture requests directly to Express so original bytes remain available for later signature verification.
- Use revocable database-backed browser sessions and a separate Node worker with durable Mongo job records. v1.0 has no Redis requirement or raw-payload vault.
- Initial hosted beta uses one Next.js instance, one API and one worker; shared live fan-out and distributed limits are later work. Private dashboard data must not enter shared caches.
- D01.3 pins Node.js 24.22.0 and npm 11.19.1, with exact workspace dependencies and a frozen lockfile. [Toolchain evidence](TOOLCHAIN.md) records clean dependency bootstrap, strict resolution, runtime/type smoke checks and an isolated Next.js build; this is not verification of a product application.
- One developer with working MERN knowledge is assumed to spend approximately 5–6 focused hours per development day, totaling 200–240 hours across 40 development days. Day ranges are estimates, not calendar deadlines.
- D01.2 established the repository layout, README, MIT license and task labels. See [README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for the current foundation. The current toolchain/dependency baseline is recorded in [TOOLCHAIN.md](TOOLCHAIN.md).
- Empiric Infotech owns the public repository and `empiricinfotech` is the account whose public evidence is to be tracked. No fresh GHFind scan, adoption, independent review or score improvement is claimed.

## Four release milestones and acceptance criteria

These are **GitHub planning issues**, not published releases or completed delivery work. All release acceptance checks remain pending. A milestone issue closes only when its observable checks have supporting evidence; finishing D01.1 does not close it.

| Release | Development days | Access | Planning issue |
|---|---|---|---|
| v0.1 Local preview | 1 to 10 | Local development only | [v0.1 milestone](https://github.com/empiricinfotech/webhook-inbox/issues/1) |
| v0.2 Authenticated beta | 11 to 20 | Invited testers | [v0.2 milestone](https://github.com/empiricinfotech/webhook-inbox/issues/2) |
| v0.3 Team and replay beta | 21 to 30 | Restricted beta | [v0.3 milestone](https://github.com/empiricinfotech/webhook-inbox/issues/3) |
| v1.0 Public release | 31 to 40 | Public code and documented deployment; deployed inbox data remains private | [v1.0 milestone](https://github.com/empiricinfotech/webhook-inbox/issues/4) |

### v0.1 Local preview

Tasks: D01.1–D10.3. None; complete the ordered D01–D10 work before release.

**Planned outcome:** Repository foundation, local workspace/inbox setup, tokenized bounded capture, credential redaction, sanitized persistence, paginated inspection, deletion, and local setup documentation.

**Acceptance criteria (pending):**

- [ ] A fresh tester follows the README from a clean local environment, starts the stack, and creates an inbox without undocumented help.
- [ ] A synthetic JSON request sent to /capture/:token returns 201 with an event ID only after sanitized storage succeeds; the same event can be found and inspected.
- [ ] The detail shows received time, method, content type, signature state, safe headers and sanitized body; generic capture is explicitly unverified and hostile HTML renders as text.
- [ ] An oversized body returns 413 without partial storage; unavailable storage returns 503; missing and disabled inboxes return 404 and 410 respectively.
- [ ] Deletion removes the event from normal lists and makes its detail inaccessible.
- [ ] Record the capture-to-inspect browser journey and a synthetic-data demo, resolve preview blockers, and publish v0.1 release notes and a tag while retaining local-only operation.

**Boundary:** Hosted unrestricted traffic, browser accounts, team roles, live SSE, provider signature verification, and replay are not v0.1 features.

### v0.2 Authenticated beta

Tasks: D11.1–D20.3. v0.1 acceptance and D10 complete; follow D11–D20 in order.

**Planned outcome:** Operator/invite-only bootstrap, login and revocable cookie sessions, one-time recovery codes, workspace ownership and authorization, retention settings, filters, SSE with polling fallback, expiry enforcement, private HTTPS deployment, and GitHub signature verification.

**Acceptance criteria (pending):**

- [ ] An invited tester logs in, captures a synthetic event in a private HTTPS environment, refreshes the browser and remains signed in; anonymous access to event details is denied.
- [ ] Logout and recovery revoke sessions, recovery codes work once, CSRF-less browser mutations fail, and guessed cross-workspace inbox/event IDs cannot read, delete or rotate credentials.
- [ ] Filters restore for an authorized user from the application URL; live updates reconnect with polling fallback and revoked access stops receiving notices within the documented check interval.
- [ ] Expired events cannot be read or resolved through live updates before physical MongoDB TTL cleanup; shortening retention hides already-expired records.
- [ ] A real configured GitHub test delivery verifies against bounded original bytes; altered, missing-signature and wrong-secret fixtures are rejected without retaining their bodies.
- [ ] Record authorization, expiry, installation and signature evidence, fix release blockers, and publish authenticated beta v0.2 with its GitHub integration instructions.

**Boundary:** Team invitation/role management, collaboration, audit UI, and controlled replay remain for v0.3.

### v0.3 Team and replay beta

Tasks: D21.1–D30.3. v0.2 acceptance and D20 complete; follow D21–D30 in order.

**Planned outcome:** Owner/member/viewer roles, one-time matching-address invitations, owner transfer, tags/bookmarks/comments, owner-only safe audit history, allowlisted destinations, outbound protections, durable replay jobs, preview/confirmation, one dispatch attempt, queued cancellation and explicit linked manual retry.

**Acceptance criteria (pending):**

- [ ] Owner, member and viewer browser journeys obey the role matrix; a viewer cannot mutate data or trigger replay, a removed member loses access, and the last owner cannot be removed.
- [ ] An invitation can be accepted once by the matching signed-in address, cannot grant owner rights, and fails after expiry or revocation.
- [ ] Authorized annotations respect event expiry; owner-only audit records identify configuration/credential/export/replay actions without secrets or captured bodies.
- [ ] Hosted replay rejects unapproved hosts, private/loopback/link-local/metadata addresses, unsafe IPv4/IPv6 resolutions, DNS rebinding, redirects and unsafe headers; destination policy is revalidated before dispatch.
- [ ] A confirmed replay reaches a controlled receiver once with sanitized content and no original provider signature represented as valid authentication; bounded redacted status/timing/response evidence appears in history.
- [ ] Duplicate idempotency submissions resolve to one job and conflicting input returns 409; crash-before-send, crash-after-send, stale worker, deleted event, revoked member and disabled destination scenarios are verified.
- [ ] Uncertain prior delivery is shown as unknown and is never automatically resent; cancellation is limited to queued work and a manual retry creates an explicit linked job.
- [ ] An invited team follows the documented debugging and replay journey without access leaks; collect beta feedback, fix blockers, document delivery limits and tag v0.3.

**Boundary:** Automatic retries, exactly-once delivery, arbitrary replay URLs and exact raw-body replay remain outside v1.0.

### v1.0 Public release

Tasks: D31.1–D40.3. v0.3 acceptance and D30 complete; D40 also requires D38 complete journeys and the D39 release candidate.

**Planned outcome:** Same-workspace JSON comparison, sanitized fixture/cURL export, scoped personal read tokens and OpenAPI, quotas/usage/health/worker lag, measured performance, repeatable self-hosting, backup/restore/upgrade drills, accessibility, documentation, synthetic demonstration and release feedback intake.

**Acceptance criteria (pending):**

- [ ] Two accessible live JSON events produce correct added/removed/changed fields; sanitized fixture and shell-quoted cURL exports respect permissions and omit credentials, capture tokens and original signatures.
- [ ] Read tokens are workspace-scoped, expire and revoke correctly, cannot write, and lose access when their owner's membership is removed.
- [ ] Concurrent captures cannot bypass configured quotas; failed inserts and worker restarts reconcile conservative counts, dependency failure changes readiness, and worker lag is visible.
- [ ] Performance notes record the environment, dataset, concurrency and observed p95 capture/list results; investigate measured bottlenecks against the plan's targets without claiming guaranteed capacity.
- [ ] A fresh developer follows documented self-hosting instructions to capture an event; backup plus separate encryption-key recovery restores synthetic records with outbound replay disabled until jobs are reconciled, and upgrade/rollback is exercised.
- [ ] Keyboard, focus, contrast, labels and complete capture/isolation/compare/export/replay browser journeys pass; a fresh tester completes the documentation workflow using synthetic demo data.
- [ ] Clean-install, build, regression, dependency, access, retention and recovery checks pass; no blocker remains in isolation, capture correctness, replay controls or recovery.
- [ ] Publish approved v1.0 code, release notes, install instructions and synthetic demonstration; invite initial users, record actionable feedback, and review public evidence and fresh GHFind scores only when available.

**Boundary:** Billing, AI features, mobile apps, Kubernetes, unlimited retention, anonymous sharing, arbitrary JavaScript transformations, raw payload vault/replay, exactly-once delivery, automatic retries, enterprise SSO, custom tunneling and email invitation delivery remain outside v1.0.


## D01.1 completion evidence and handoff

D01.1 is complete when this user/problem/journey/scope contract and all four published planning issues are verified against the source plan. See [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) for the checks and checkpoint evaluation.

The aggregate Day 01 acceptance is now supported by the documented first-release scope and the dependency-only `npm run bootstrap` command verified in D01.3. D01.1, D01.2 and D01.3 are complete. D02.1 shell/startup verification is documented in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). D02.2 connection/health evidence is in [MONGODB_LOCAL.md](MONGODB_LOCAL.md). D02.3 tooling/routing is complete. D03.1 shared contracts and request correlation are documented in [API_CONTRACTS.md](API_CONTRACTS.md). D03.2 test harness evidence is in [TESTING.md](TESTING.md). D03.3 CI is next and has not been started.

# Empiric Webhook Inbox

A self-hostable developer tool planned for capturing, inspecting, comparing and replaying sanitized webhook test events.

**Status:** repository foundation and product planning. The directory layout, documentation, MIT license and task labels are in place. There is no runnable application, dependency manifest, installation script or published release yet.

## Why this project exists

MERN developers, integration engineers, QA testers and small agency teams need to know whether a webhook arrived and what it contained. This project aims to replace scattered debugging logs with an inspectable inbox and a repeatable workflow.

The first usable release will let a single maintainer create a local inbox, send a synthetic JSON request, find the stored event, inspect its safe content and delete it. A successful capture will confirm storage; it will not confirm processing by another business application. See the [project brief](docs/PROJECT_BRIEF.md) for the full journey and boundaries.

## Get the repository

Git is sufficient to read the documentation and inspect the structure:

```bash
git clone https://github.com/empiricinfotech/webhook-inbox.git
cd webhook-inbox
git status
```

### Installation and run status

Application install, bootstrap, development and test commands are **not available yet**. Do not assume that `npm install`, `npm run dev` or the suggested scripts in the plan work today.

D01.3 will pin the runtime and package manager, verify compatible packages and introduce the lockfile. D02 will add the application skeleton and startup configuration. The plan proposes Node.js 24 LTS and MongoDB; no runtime version or application dependencies have been installed or verified in this foundation task.

## Planned architecture

- **Frontend:** Next.js with React, TypeScript and App Router. Interactive forms, query providers and event subscriptions belong in Client Components.
- **API:** a separate Express service owns authentication, authorization, database access, bounded capture and management endpoints under `/api/v1`.
- **Capture:** providers send requests directly to Express at `/capture/:token`; original bytes remain available for later signature verification.
- **Data and worker:** MongoDB/Mongoose stores sanitized events and durable jobs; a separate Node worker will handle retention cleanup and controlled replay.
- **Hosting:** a shared origin will route frontend pages to Next.js and API/capture/health paths to Express. UI route guards do not replace API permission checks.

These are design decisions, not implemented services. [PROJECT_DOCUMENTATION.md](docs/PROJECT_DOCUMENTATION.md) is the authoritative architecture and ordered backlog.

## Repository layout

The directories below are tracked using empty `.gitkeep` files where needed. They reserve the planned boundaries without application scaffolding.

```text
apps/
  web/src/
    app/          Next.js App Router pages and layouts
    features/     Interactive Client Components and hooks
    components/   Shared frontend components
    lib/          API client and browser query providers
  api/src/        Express routes and domain services
  worker/src/     Job claims, replay and retention cleanup
packages/
  contracts/      Shared schemas and API types
  test-data/      Synthetic webhook fixtures
docs/             Product plan, brief and implementation history
tests/e2e/        Future browser journeys
infra/            Future Compose and reverse-proxy configuration
.github/          Task-label manifest and repository metadata
```

No package/workspace configuration, runtime pin, application source, fixtures, containers or CI workflow is included yet. Local credentials, environment files, dependencies and generated outputs are excluded by [.gitignore](.gitignore); placeholder environment examples can be committed when their schemas are defined.

## Release roadmap

All four releases are future work. Development-day ranges are effort estimates rather than calendar deadlines.

| Milestone | Days | Intended result | Tracking |
|---|---|---|---|
| v0.1 Local preview | 1 to 10 | Local-only capture, inspect and delete journey | [Issue #1](https://github.com/empiricinfotech/webhook-inbox/issues/1) |
| v0.2 Authenticated beta | 11 to 20 | Private workspaces, sessions, expiry, live notices and GitHub verification | [Issue #2](https://github.com/empiricinfotech/webhook-inbox/issues/2) |
| v0.3 Team and replay beta | 21 to 30 | Roles, collaboration, audit history and controlled replay | [Issue #3](https://github.com/empiricinfotech/webhook-inbox/issues/3) |
| v1.0 Public release | 31 to 40 | Compare/export, scoped read tokens, self-hosting and recovery evidence | [Issue #4](https://github.com/empiricinfotech/webhook-inbox/issues/4) |

Each issue contains observable release criteria. [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md) records completed tasks separately from pending release work. D01.3 is next; it has not been started.

## Data and scope boundaries

Use synthetic data in examples, screenshots and shared demonstrations. Public source does not make deployed inbox data public. The unauthenticated v0.1 preview is planned for local development only.

The plan persists sanitized evidence rather than a raw-payload vault. Later replay will send a sanitized test copy to an approved destination, omit original provider signatures as authentication, make one attempt per job and require explicit manual retry. An uncertain delivery will remain unknown rather than being automatically resent.

Billing, AI summaries, mobile apps, Kubernetes, unlimited retention, anonymous sharing, arbitrary transformations, exact raw replay, guaranteed exactly-once delivery, enterprise SSO and a custom tunnel are outside v1.0. The [brief](docs/PROJECT_BRIEF.md) provides the full scope.

## Documentation and contributions

- [Project brief](docs/PROJECT_BRIEF.md): users, first capture journey, scope and milestone criteria.
- [Project documentation](docs/PROJECT_DOCUMENTATION.md): architecture, modules and 120-task backlog.
- [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md): actual work, verification and remaining tasks.
- [Contributing](CONTRIBUTING.md): task selection, current checks, review expectations and issue-label usage.
- [Task labels](.github/README.md): configured labels and their local manifest.
- [Growth checklist](docs/EMPIRIC_PROJECT_GROWTH_CHECKLIST.md): evidence-based project upkeep; no score gains are promised.

Search the [existing issues](https://github.com/empiricinfotech/webhook-inbox/issues) before reporting a problem or proposing a change. Describe a concrete need, expected result and verification steps. Do not include credentials, real webhook payloads or client data in an issue.

## License

[MIT](LICENSE), copyright 2026 Empiric Infotech LLP. MIT was selected to support straightforward reuse, self-hosting and contributions while retaining copyright and license notices. Third-party dependencies will retain their own licenses when selected.

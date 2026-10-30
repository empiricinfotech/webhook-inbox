# Contributing to Empiric Webhook Inbox

The repository is in its foundation stage. Read the [README](README.md), [project brief](docs/PROJECT_BRIEF.md), [ordered backlog](docs/PROJECT_DOCUMENTATION.md) and [progress log](docs/IMPLEMENTATION_PROGRESS.md) before choosing work. The canonical repository is [empiricinfotech/webhook-inbox](https://github.com/empiricinfotech/webhook-inbox).

## Pick a coherent task

Search existing issues and PRs before opening anything new. The four existing milestone issues track release outcomes, not completed implementation. Keep their acceptance checks pending until evidence supports them.

Use the next eligible task in the plan and finish its prerequisites first. Keep one implementation task in progress per developer, reference its task ID and stop at the agreed scope. D01.3 pins Node.js 24.22.0, npm 11.19.1 and the foundation dependencies. D02.1 adds the Next.js shell, Express startup, shared TypeScript settings and environment schemas. D02.2 adds local Mongo connectivity and health routes; D02.3 adds lint/typecheck/build commands, development API routing and sample configuration. D03.1 adds shared contracts and request correlation; D03.2 adds the Vitest/Supertest/disposable-data harness. D03.3 adds PR/push verification; see [CI](docs/CI.md) for its checks and acceptance evidence. D04.1 adds [workspace/inbox metadata schemas](docs/DATA_MODELS.md); D04.2 adds [capture-token crypto and internal retrieval](docs/CAPTURE_TOKENS.md). D04.3 adds [local operator bootstrap and inbox creation/listing](docs/LOCAL_INBOX.md); [D05.1](docs/INBOX_UI.md) connects list/create/detail UI to an opt-in local API; D05.2 is next.

Create an issue when useful using these fields:

- Task ID/title, module and prerequisite IDs.
- User problem and expected result.
- Implementation scope and observable acceptance checks.
- Verification evidence and documentation changes.

A bug report should include reproducible steps, expected behavior and observed behavior. Use synthetic examples with secrets removed. Do not create issues or split PRs solely to increase activity.

## Development setup today

Use the [README](README.md) to clone the repository and activate Node.js 24.22.0 with npm 11.19.1. The complete exact-version matrix and supported verification scope are in [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md).

```bash
npm run bootstrap
npm run check:toolchain
npm run check:dependencies
npm run check:foundation
npm run check:contracts
npm test
npm run lint
npm run typecheck
npm run build
npm run check:routing
git diff --check
git diff --cached --check
git status --short
```

Bootstrap installs the locked dependencies of all six private workspaces. Dependency checks validate the resolved package tree and exercise library imports with synthetic in-memory values; they do not start an application or connect to MongoDB.

Preserve `package-lock.json` and use `npm ci` for repeatable installs. Add or update an exact dependency only when it belongs to the selected task, and regenerate the lockfile with the pinned npm version. Recheck engines, peers, dependency smoke behavior, affected application checks and package licenses when changing the baseline.

An exact `esbuild@0.28.2` install-script allowance is recorded for the tsx toolchain. Review script-policy changes when a dependency update introduces or changes a lifecycle script; do not replace the policy with a blanket allowance.

See [local development](docs/LOCAL_DEVELOPMENT.md) for `dev:web`, `dev:api`, environment rules and consolidated build/check commands. The five foundation checks use the existing tsx runner and Node test API. Run `npm run check:mongo` for connection/readiness changes; it requires a native MongoDB 8 binary and creates only isolated test data, as described in [Mongo verification](docs/MONGODB_LOCAL.md#verification). `npm run check:compiled-api` rebuilds the backend and repeats the Mongo checks against its emitted JavaScript with Node TypeScript stripping disabled. `check:routing` starts isolated Next/transport fixtures; it requires no running API/database and never copies local environment files. `check:contracts` preserves the six identifier/pagination/error/correlation regressions, now split between Vitest unit/API projects. See [API contracts](docs/API_CONTRACTS.md). [Testing](docs/TESTING.md) documents Vitest, Supertest and disposable Mongo fixtures. `test:unit` needs no Mongo service; `test:api` and `test` need a native MongoDB 8 binary and allocate their own processes/data. Browser journeys remain later release work; [CI](docs/CI.md) runs the foundation checks. Do not infer working capture or a release from shell startup.

Stage only the intended files and preserve unrelated work and Git identity settings. For documentation-only edits, use relevant link/content/whitespace checks; run the dependency checks when manifests or the lockfile change.

## Issue labels

Choose the smallest useful set:

| Label | Use |
|---|---|
| `api` | Express management API, capture routes and backend services |
| `web` | Next.js frontend, layouts and client interactions |
| `worker` | Background jobs, retention cleanup and recovery |
| `docs` | Project documentation and examples |
| `tests` | Verification work and regressions |
| `bug` | A reproducible defect |
| `milestone:v0.1` through `milestone:v1.0` | The release the work supports; use one of the four configured versions |

The exact names, descriptions and colors are in [.github/labels.json](.github/labels.json). Existing GitHub default labels remain available; `docs` is this project's canonical documentation-area label, while the pre-existing `documentation` label was preserved. Labels organize work and do not demonstrate completion or adoption. Board state names in the plan are separate from these task labels.

## Submit and review

Use a branch for a proposed change; `codex/` is the default prefix for agent-created branches. Preserve unrelated work and each contributor's Git identity. Follow the maintainer's authorized remote/branch workflow.

A PR should explain the problem and resulting behavior, related task IDs, what changed, how it was checked, relevant data/permission changes and known limitations. Include screenshots only for visual behavior.

Perform honest self-verification and record it when no independent reviewer is available. Do not claim an external review, passing application tests or a merged result that did not happen. Update the progress log and affected docs without removing earlier history. Close a milestone only after its release criteria are demonstrated.

## Public data and license

Keep local environment values, tokens, session cookies, verification secrets, real captured messages and proprietary/client code outside commits and issues. Commit only placeholder configuration examples and synthetic fixtures when those are introduced.

This project uses the [MIT License](LICENSE). Preserve applicable copyright/license notices and third-party attribution.

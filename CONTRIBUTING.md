# Contributing to Empiric Webhook Inbox

The repository is in its foundation stage. Read the [README](README.md), [project brief](docs/PROJECT_BRIEF.md), [ordered backlog](docs/PROJECT_DOCUMENTATION.md) and [progress log](docs/IMPLEMENTATION_PROGRESS.md) before choosing work. The canonical repository is [empiricinfotech/webhook-inbox](https://github.com/empiricinfotech/webhook-inbox).

## Pick a coherent task

Search existing issues and PRs before opening anything new. The four existing milestone issues track release outcomes, not completed implementation. Keep their acceptance checks pending until evidence supports them.

Use the next eligible task in the plan and finish its prerequisites first. Keep one implementation task in progress per developer, reference its task ID and stop at the agreed scope. D01.3 is next; runtime selection and package compatibility have not been performed.

Create an issue when useful using these fields:

- Task ID/title, module and prerequisite IDs.
- User problem and expected result.
- Implementation scope and observable acceptance checks.
- Verification evidence and documentation changes.

A bug report should include reproducible steps, expected behavior and observed behavior. Use synthetic examples with secrets removed. Do not create issues or split PRs solely to increase activity.

## Development setup today

Clone the repository using the README commands. No package manager, dependency manifest, bootstrap script or runnable application is available yet. Runtime/package selection belongs to D01.3; application startup and test tooling arrive in later foundation tasks. Do not invent commands to fill this gap.

The directory placeholders follow the Next.js frontend, separate Express API, MongoDB and worker boundaries. Put authorization and persistence in the backend services rather than frontend-only route checks.

For a documentation-only change, review relative links and scope statements and run:

```bash
git diff --check
git diff --cached --check
git status --short
```

Stage only the intended files. As meaningful application checks are introduced, document and run the relevant lint, typecheck, build and test commands; none are claimed to exist now.

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

# Webhook Inbox Conversation Context

## Purpose

This file preserves the decisions and working instructions from the conversation so a new chat or coding agent can continue without repeating the research and planning. Read the actual repository and its documentation before implementing anything. This context summarizes the conversation; it does not certify that planned features are implemented.

Context prepared on 21 October 2026. User timezone: Asia/Kolkata.

## User objective

The user wants to improve the public GitHub footprint and GHFind score of Empiric Infotech through useful, sustained engineering work on one flagship project. They want a realistic MERN project with at least 30 to 40 development days of meaningful work and a clear sequence for selecting tasks.

The user prefers simple explanations, concrete steps and reusable Markdown documentation. They want the daily implementation workflow to finish a task, check the applicable growth checkpoints, commit the changes and push them.

## Accounts researched

- Personal profile: https://github.com/Niralempiric
- Personal GHFind page: https://ghfind.com/en/u/Niralempiric
- Company-branded profile: https://github.com/empiricinfotech
- Company GHFind page: https://ghfind.com/en/u/empiricinfotech

The discussion subsequently focused on empiricinfotech.

### Historical findings

On 19 October 2026, the GHFind pages displayed historical scores that predated the then-current scoring release. These values are background context, not fresh measurements.

| Category | Niralempiric | empiricinfotech | Displayed maximum |
|---|---:|---:|---:|
| Account maturity | 8.0 | 6.9 | 10 |
| Original project quality | 0.0 | 5.8 | 18 |
| Contribution quality | 5.4 | 0.0 | 27 |
| Ecosystem or maintenance impact | 0.0 | 0.0 | 20 |
| Community influence | 2.0 | 0.0 | 8 |
| Activity authenticity | 11.1 | 8.1 | 17 |
| Total | 26.50 | 20.80 | 100 |

At that inspection, Niralempiric had five public repositories, all forks. The empiricinfotech profile listed 39 public repositories, including TrustHire-AI, Empira_HR and Nexus-AI. TrustHire-AI's README contained a placeholder clone URL, and its About section lacked a description, website and topics. Recheck these details before treating them as current problems.

## Scoring conclusions and corrections

- GHFind evaluates public GitHub evidence. Keep proprietary and client projects private; maintain a genuinely useful public project or standalone public component alongside them.
- A deployed public demo with private source does not provide the same inspectable engineering evidence as a public code repository.
- One strong project can support several scoring categories. Creating a repository alone does not maximize them.
- Useful merged PRs in one's own projects can contribute to contribution quality. Earlier advice emphasizing only external PRs was corrected after reading the scoring implementation.
- Ecosystem impact needs qualifying reach and substantial work; maintaining a new, little-used repository does not automatically establish broad impact. Relevant upstream fixes are another route.
- Genuine followers and repository stars are distinct signals. Stars principally support project recognition; follower signals support community influence.
- Account maturity depends on age and contribution history across years and cannot be completed in a short sprint.
- Attribute work accurately. A team member's PR in a company-owned repository does not automatically become a PR authored by empiricinfotech. Current methodology may recognize attributable leadership, but inspect the evidence rather than assuming credit.
- Tests, documentation and releases make the project useful. Each individual checklist action is not a guaranteed point increment.
- Avoid purchased stars or followers, empty commits, artificial PR splitting, duplicate issues and activity created only to inflate counts.
- Scoring rules changed during the research period, including terminology around original and led projects. Recheck the current rules and compare scans from compatible releases.

## Selected project

Working name: **Empiric Webhook Inbox**.

Build a public, self-hostable developer tool that receives webhook messages, stores sanitized debugging evidence, and helps small teams inspect, compare, export and replay test copies.

Example journey: create a GitHub staging inbox, receive an issue event, inspect the payload, compare it with another event and send a sanitized test copy to an explicitly configured receiver.

The user asked for comprehensive documentation after this idea was recommended. The project documentation now serves as the planning baseline. No application implementation was performed in this conversation.

### Product boundary

This is a debugging inbox, not an enterprise event gateway or production payment processor. Successful capture means the event was stored; it does not mean another application processed it. A public repository does not make captured customer data public. Shared demonstrations use synthetic data.

### Stack decisions

- MERN: MongoDB, Express, React and Node.js.
- TypeScript throughout; Node.js 24 LTS was the recommended baseline on the research date.
- React with Vite, React Router, Tailwind CSS and TanStack Query.
- MongoDB with Mongoose; shared validation contracts using Zod.
- Revocable opaque database-backed sessions in protected browser cookies.
- Server Sent Events for live notices, with polling fallback.
- Separate Node worker and durable Mongo job records; no Redis requirement for v1.0.
- Pino logging, Vitest, Supertest, Playwright, Docker Compose, GitHub Actions and OpenAPI.

Verify compatible package versions during implementation; the document is not a package lockfile.

### Important architecture decisions

- Browser management API under /api/v1; tokenized capture route under /capture/:token.
- Workspace roles: owner, member and viewer, enforced in the API and worker.
- Verify supported provider signatures against bounded original bytes before parsing or redaction.
- Persist sanitized payloads only; an exact raw-payload vault is outside v1.0.
- Replay uses sanitized content and never forwards an original provider signature as valid authentication for a modified body.
- Replay targets must match operator policy and destination settings, with outbound request protections and repeated validation.
- One dispatch attempt per replay job; retries require explicit action. An uncertain delivery becomes unknown and is not silently resent.
- Expired and deleted events are blocked at read/export/replay time, independently of background TTL cleanup.
- Initial hosted beta uses one API instance and one worker. Scale-out coordination is later work.

### Modules

1. M01 Project foundation
2. M02 Workspace and inbox management
3. M03 Capture pipeline
4. M04 Request explorer
5. M05 Accounts and sessions
6. M06 Tenant authorization
7. M07 Live event updates
8. M08 Retention and data controls
9. M09 Provider verification
10. M10 Team collaboration
11. M11 Audit history
12. M12 Replay destinations
13. M13 Replay jobs and attempts
14. M14 Payload comparison and fixtures
15. M15 API tokens and reference
16. M16 Usage and health
17. M17 Deployment and recovery
18. M18 Public release and contribution

### Planned milestones

| Days | Milestone |
|---|---|
| 1 to 10 | Local preview v0.1 |
| 11 to 20 | Authenticated beta v0.2 |
| 21 to 30 | Team and controlled replay beta v0.3 |
| 31 to 40 | Public release v1.0 |

There are 40 development days and 120 task IDs, D01.1 through D40.3. Estimate 5 to 6 focused hours per development day for someone with working MERN knowledge, approximately 200 to 240 hours. These are planning estimates, not guaranteed calendar dates. Testing, review and documentation belong within the work.

## Repository and authoritative document paths

The user identified this actual project location:

```text
/home/empiric-60/Public/project/ghfind-score/webhook-inbox
```

Use these project-local documents for future task execution:

```text
/home/empiric-60/Public/project/ghfind-score/webhook-inbox/docs/PROJECT_DOCUMENTATION.md
/home/empiric-60/Public/project/ghfind-score/webhook-inbox/docs/EMPIRIC_PROJECT_GROWTH_CHECKLIST.md
```

Both files were confirmed to exist while preparing this context. Their current contents and repository implementation were not audited in this context-creation step.

Progress location specified by the daily workflow:

```text
/home/empiric-60/Public/project/ghfind-score/webhook-inbox/docs/IMPLEMENTATION_PROGRESS.md
```

That progress file was not found at the exact path during this context-creation step. Create it when running the implementation workflow if it is still absent. Check for another existing tracking mechanism before duplicating records. If docs/TASK_BOARD.md exists, keep it consistent.

Original artifacts created during planning remain here:

```text
/home/empiric-60/Documents/ChatGPT/internal/webhook-inbox-plan/PROJECT_DOCUMENTATION.md
/home/empiric-60/Documents/ChatGPT/internal/webhook-inbox-plan/TASK_BOARD.md
/home/empiric-60/Documents/ChatGPT/internal/EMPIRIC_PROJECT_GROWTH_CHECKLIST.md
```

The original plan was checked for 18 modules, 40 days, 120 unique task IDs, a matching task board and dependencies pointing to earlier days. Future edits require fresh consistency checks. The project-local files take precedence over these original copies when they have been updated.

## Fixed daily execution workflow

The user requested one reusable prompt that performs one task per run, checks the growth checklist, and commits and pushes the resulting work. The agreed prompt has the following requirements.

### Inspect and select

1. Read applicable AGENTS.md instructions, both project documents and existing progress records.
2. Inspect the repository, current branch, remotes, recent commits and working-tree changes.
3. Preserve unrelated changes and existing Git identity settings.
4. Verify implementation evidence instead of assuming the progress record is correct.
5. Resume an unfinished task first; otherwise select the earliest unfinished eligible task.
6. Satisfy missing prerequisites before advancing.
7. Announce the task ID, intended result and acceptance checks, then implement it.

Select **one task such as D01.1**, not a whole day's three tasks. Do not assume D01.1 is next without inspecting the repository.

### Implement and verify

- Complete the selected task using the documented architecture and conventions.
- Add meaningful tests as appropriate, update affected documentation and verify relevant flows.
- Fix problems introduced by the selected task and record unrelated findings separately.
- Read the entire growth checklist and evaluate each checkpoint for applicability.
- Record phase results as completed for this run, pending, not applicable or blocked, with a short reason.
- Do not permanently mark an entire phase complete after one increment.
- Do not invent reviews, users, adoption or score improvements.
- Do not create issues, PRs, releases or posts merely to increase activity.
- Mark a task complete only when its acceptance checks pass.
- If essential access or a decision is missing, preserve work and report the concrete blocker.

### Record progress

Maintain docs/IMPLEMENTATION_PROGRESS.md with:

- Task ID and title.
- Status: in progress, completed or blocked.
- Work performed and files affected.
- Acceptance results and verification commands.
- Applicable growth-checklist results and pending checkpoints.
- Known limitations and blockers.
- Next eligible task ID.

Preserve previous history and update the task board if present.

### Commit and push

For an authorized daily implementation run, the user wants all changes made for the selected task committed and pushed, including code, tests, documentation and progress records.

- Use the current branch when suitable; use a codex/ prefix if a new branch is necessary.
- Stage selected-task changes only, preserving unrelated existing work.
- Use a descriptive commit containing the task ID.
- Push to the configured appropriate remote branch and set upstream if needed.
- Verify that the pushed remote branch contains the new commit.
- Integrate remote advancement safely and rerun affected checks.
- Never force-push, discard unrelated work, rewrite history or change repository visibility.
- Preserve a local commit and report the reason if pushing fails.
- Do not make an empty commit when no implementation change is needed.

Stop after the one selected task. End with task status, changes, verification, checkpoint results, commit hash, branch, push status and next task ID.

## Current state and authorization boundary

Completed in this conversation: profile research, scoring guidance, project selection, the growth checklist, comprehensive project documentation, a task-board companion, the fixed daily prompt and this context file.

Not performed in this conversation: repository implementation, GitHub issue creation, release publication, deployment, application testing, commits or pushes. The actual repository may contain work from other sessions; inspect it before making status claims.

The latest user request was to create this context file. That request does not itself start the daily implementation workflow. When asked to continue or run the daily task, follow the fixed workflow above and the active environment permissions.

The project directory lies outside the writable roots of the context-creation session. Respect the next session's actual sandbox permissions; do not assume a known path is writable.

## Artifact delivery note

The project documentation was delivered as Markdown. A Word edition was drafted, but the bundled renderer could not run because of system-library incompatibility. It was not delivered as a visually verified Word file. The complete requested content is in the Markdown artifacts; no Word dependency is required to implement the project.

## Sources for future verification

- GHFind methodology: https://ghfind.com/en/methodology
- GHFind scoring implementation: https://github.com/hikariming/ghfind/blob/main/src/lib/score.ts
- GHFind public-data limitation: https://github.com/hikariming/ghfind#disclaimer
- GitHub account attribution: https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts
- GitHub webhook testing: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks
- GitHub signature validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- MongoDB TTL behaviour: https://www.mongodb.com/docs/manual/core/index-ttl/
- Outbound request protection: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Node.js release status: https://nodejs.org/en/about/previous-releases

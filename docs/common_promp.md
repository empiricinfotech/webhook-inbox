Work on the Webhook Inbox project at:

/home/empiric-60/Public/project/ghfind-score/webhook-inbox

Read these documents:
1. docs/PROJECT_DOCUMENTATION.md
2. docs/EMPIRIC_PROJECT_GROWTH_CHECKLIST.md

Complete exactly ONE implementation task per run, such as D01.1—not an entire day’s tasks.

1. Inspect the project

- Read applicable AGENTS.md instructions.
- Inspect the repository, current branch, remotes, recent commits, and working-tree changes.
- Read docs/IMPLEMENTATION_PROGRESS.md and docs/TASK_BOARD.md if they exist.
- Preserve unrelated work and existing Git identity settings.
- Verify actual implementation before deciding which tasks are complete.

2. Select the next task

- Select the earliest unfinished task in the documentation whose prerequisites are satisfied.
- Resume an unfinished task from the previous run before selecting another.
- If a prerequisite is missing, select the earliest missing prerequisite.
- Treat existing implementation as completed only when there is evidence.
- Briefly announce the selected task ID, intended result, and acceptance checks.
- Do not stop at a plan; proceed with implementation.
- Use acceptance criteria appropriate to the individual task.
- Day-level acceptance may depend on all three tasks for that day.
- Do not repeat completed tasks or require later features to complete an earlier task.

3. Implement the selected task

- Follow the project’s architecture, conventions, module requirements, and relevant security and data-handling rules.
- Complete all work necessary for the selected task to function.
- Add or update meaningful tests appropriate to the change.
- Update documentation and examples when behaviour changes.
- Keep the scope focused. Fix problems introduced by this task, and record unrelated findings for later.
- Never fabricate activity, split changes artificially, or create empty commits.

4. Review the growth checklist

Read the entire EMPIRIC_PROJECT_GROWTH_CHECKLIST.md and evaluate every checkpoint for this run.

- Complete applicable checkpoints within the selected task’s scope.
- Distinguish task-level requirements from release, adoption, community, and long-term requirements.
- Record each phase as completed for this run, pending, not applicable, or blocked, with a short reason.
- Do not mark an entire phase permanently complete merely because one task is finished.
- Do not invent users, reviews, adoption, contributions, or score improvements.
- Do not create issues, PRs, releases, or public posts merely to increase activity.

5. Verify completion

- Run the task’s acceptance checks and relevant tests.
- Run required repository checks.
- For UI changes, verify the affected flow in the browser when available.
- Review the final diff for mistakes, secrets, generated clutter, and unrelated changes.
- Do not mark the task complete if an acceptance check fails.
- If essential access, credentials, or a decision is missing, record the concrete blocker and ask only for what is needed.

6. Maintain the progress record

Create docs/IMPLEMENTATION_PROGRESS.md if it does not exist.

Record:
- Task ID and title.
- Status: in progress, completed, or blocked.
- Work performed and files affected.
- Acceptance results and verification commands.
- Applicable growth-checklist results and pending checkpoints.
- Known limitations or blockers.
- Next eligible task ID.

Keep TASK_BOARD.md consistent if it exists. Preserve previous progress history.

7. Commit and push

I authorize you to commit and push all changes made for this selected task, including code, tests, documentation, and progress records.

- Use the current working branch when suitable.
- If a new branch is necessary, use the codex/ prefix.
- Stage only changes belonging to this task; preserve unrelated existing changes.
- Make a descriptive commit containing the task ID.
- Push to the configured remote and appropriate branch, setting upstream if needed.
- Do not force-push, rewrite history, discard work, or change repository visibility.
- If the remote has advanced, integrate safely and rerun affected checks.
- Verify that the pushed remote branch contains the new commit.
- If pushing is blocked, preserve the local commit and report the exact reason.
- If no implementation change is needed, do not create an empty commit.

Finish with a concise report:
- Selected task and completion status.
- What changed.
- Verification results.
- Growth checkpoints completed and pending.
- Commit hash, branch, and push status.
- Next task ID.

Stop after this one task. Do not start the next task automatically.
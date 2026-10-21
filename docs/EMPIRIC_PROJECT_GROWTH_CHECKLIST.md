# Empiric: One-Project Development and GHFind Growth Checklist

Use this checklist for one public flagship project throughout its life. Complete the setup phases once, repeat the development cycle for each meaningful change, and repeat release and maintenance phases as needed.

This is a recommended engineering workflow, not GHFind's official checklist. Completing a checkbox does not guarantee points. One project can support several categories, but account maturity takes time, community influence requires a real audience, and ecosystem impact requires meaningful reach. You do not need to maximize every category before shipping.

## Project details

- Project name: ____________________
- Public repository URL: ____________________
- Repository owner: ____________________
- GitHub account whose GHFind score we are tracking: ____________________
- Maintainer: ____________________
- Main problem this project solves: ____________________
- Intended users: ____________________
- First usable release goal: ____________________

## How the six categories connect to this project

| Category | Evidence the project can help build | Main limitation |
|---|---|---|
| Original & Led Projects / Original project quality | Substantial original or attributable project work, completeness and genuine adoption | A public shell or README alone provides limited evidence |
| Contribution quality | Meaningful merged PRs and issue activity | Credit depends on the account performing the work |
| Activity authenticity | Recent contributions and varied development activity | Artificial activity is not useful progress |
| Ecosystem / maintenance impact | Substantial maintenance of a popular project or contributions to established dependencies | A new, little-used repository may provide little impact evidence |
| Community influence | Genuine followers attracted by useful work | Stars and followers are different signals |
| Account maturity | Account age and contribution history across years | Cannot be completed in a short sprint |

GHFind's [methodology](https://ghfind.com/en/methodology) describes the categories. Its [scoring implementation](https://github.com/hikariming/ghfind/blob/main/src/lib/score.ts) includes own-project merged PRs, project-substance and star signals, follower signals, activity and account history. Scoring rules can change; record the version when available.

## Phase 0 — Choose the public scope and establish a baseline

**When:** Before starting this workflow.

- [ ] Choose one existing project or useful standalone component that Empiric owns and can publish.
- [ ] Keep client code, proprietary components and private data outside the public scope.
- [ ] Ensure the public part does something useful on its own.
- [ ] Decide which account's score you are measuring before interpreting results.
- [ ] Keep each contributor's authorship accurate. Team activity does not automatically become activity authored by the repository owner.
- [ ] Request a fresh GHFind scan and record all six category scores, the scan date and any actual deductions.
- [ ] Record whether the result is historical, cached or newly scanned.

GitHub attributes actions such as PRs and reviews to the user performing them. See [GitHub account attribution](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts).

**Done when:** The public scope, scored account and baseline are clear.

## Phase 1 — Prepare a usable repository

**When:** Once at the beginning; update as the project changes.

**Supports:** Project quality; discovery and adoption indirectly.

- [ ] Add a clear repository description and relevant topics.
- [ ] Write a README explaining the problem, intended users and current capabilities.
- [ ] Include exact installation and run commands with the real repository URL.
- [ ] Document supported runtime versions and required dependencies.
- [ ] Add a working example and screenshots or a short demo where helpful.
- [ ] Provide sample configuration with placeholder values.
- [ ] Choose a suitable license for the code being published.
- [ ] Add contribution instructions explaining setup, checks and the review process.
- [ ] Add a short roadmap containing real priorities.
- [ ] Ask someone unfamiliar with the project to follow the instructions from a clean setup; fix the gaps they encounter.

**Done when:** Another developer can understand, run and try the project without private help.

## Phase 2 — Plan a real improvement

**When:** Before a meaningful feature, bug fix or maintenance task.

**Supports:** Useful issue activity and a clear development record.

- [ ] Identify an actual user need, bug, test gap or dependency problem.
- [ ] Check existing issues and PRs to avoid duplicate work.
- [ ] Open or reuse an issue when the work benefits from tracking.
- [ ] Describe the problem and the expected result.
- [ ] Add reproduction steps for bugs.
- [ ] Write a short acceptance checklist describing how completion will be verified.
- [ ] Choose one logically complete scope for the change.

Do not create an issue for every tiny edit just to increase counts.

**Done when:** The developer and reviewer agree on what success means.

## Phase 3 — Build, check, review and merge

**When:** Repeat for each meaningful change.

**Supports:** Project quality, contribution quality and authentic activity.

1. Create a branch for the change.
2. Implement the improvement with understandable commits.
3. Add or update tests where they verify important behaviour.
4. Run relevant checks and exercise the affected user flow.
5. Update examples or documentation if behaviour changed.
6. Open a PR describing the problem, solution and verification.
7. Link the related issue, if there is one.
8. Ask another maintainer to review when one is available; for solo work, document your own verification honestly.
9. Address feedback, then merge when the change is ready.
10. Confirm the default branch still works and close the resolved issue.

- [ ] The PR contains a useful, complete change.
- [ ] Important behaviour was verified.
- [ ] Review feedback is resolved or documented.
- [ ] Authorship and related issue links are correct.
- [ ] The merged result works.

**Example:** Fix a real failure when an uploaded file is empty, include a regression test and explain the expected error message.

**Done when:** The improvement is merged and verified. Opening a PR alone does not demonstrate an accepted change.

## Phase 4 — Ship a release people can use

**When:** A useful set of changes is ready; no fixed release quota.

**Supports:** Project usability and adoption; releases are not guaranteed score increments.

- [ ] Test installation and the main workflow from a clean environment.
- [ ] Confirm examples and setup instructions match the release.
- [ ] Assign an appropriate version and create a release tag.
- [ ] Write release notes explaining improvements, fixes and any breaking changes.
- [ ] Publish the package or distributable if the project needs one.
- [ ] Update the demo if its behaviour changed.
- [ ] Link the release from the README.
- [ ] Provide a clear way for users to report problems.

**Done when:** A new user can identify a stable version, install it and understand what changed.

## Phase 5 — Help people discover and adopt it

**When:** After the first useful release and after noteworthy improvements.

**Supports:** Community influence and project recognition indirectly; potential ecosystem growth.

- [ ] Pin the project on the relevant profile.
- [ ] Publish a practical tutorial or short demonstration of a real use case.
- [ ] Link to the code and installation instructions.
- [ ] Share in relevant communities where project sharing is welcome.
- [ ] Invite interested developers to try it and give specific feedback.
- [ ] Answer questions and investigate real user reports.
- [ ] Identify suitable tasks for outside contributors when such tasks exist.
- [ ] Review outside contributions thoughtfully and acknowledge the contributors.

Measure whether people can use the project successfully. Genuine stars, followers, issues and contributions may follow; do not buy or trade them.

**Done when:** Users can discover the project and get help. Continue this phase as adoption grows.

## Phase 6 — Maintain the project and its dependencies

**When:** Reserve time each week; adapt the schedule to real needs.

**Supports:** Continued activity, project quality and longer-term impact.

- [ ] Triage new issues and PRs.
- [ ] Prioritize reproducible bugs and problems blocking users.
- [ ] Keep important dependencies compatible and tests passing.
- [ ] Improve examples based on recurring questions.
- [ ] Release fixes when ready.
- [ ] Check whether a project problem originates in an external dependency.
- [ ] If it does, read that dependency's contribution guide and discuss the issue where appropriate.
- [ ] Submit a useful upstream fix with verification and respond to review feedback.

An upstream contribution can support the same flagship project without requiring you to create another product. Ecosystem points depend on the qualifying work and reach; routine maintenance of a small repository does not automatically establish broad impact.

**Done when:** Current reports are triaged and the next useful maintenance action is clear. This phase continues for the project's lifetime.

## Phase 7 — Review progress monthly and continue across years

**When:** Monthly, or after meaningful accumulated changes. This is a suggested review cadence, not a GHFind requirement.

- [ ] Review the project outcome: can users install it, use it and get help?
- [ ] Request an updated GHFind scan when appropriate.
- [ ] Record each category, actual deductions and the scan status.
- [ ] Compare scans produced under the same scoring release where possible.
- [ ] If a category is unchanged, inspect its evidence and attribution before adding more activity.
- [ ] Choose the next useful improvement based on user needs.
- [ ] Continue maintaining the project across years to build history.

| Scan date | Scored account | Scoring version / status | Project quality | Contributions | Activity | Ecosystem | Community | Maturity | Deductions | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | | | | | | | | | | |
| Review 1 | | | | | | | | | | |
| Review 2 | | | | | | | | | | |

Record evidence links separately: important merged PRs, releases, upstream fixes and examples of real adoption. A scoring release change can move the number without a corresponding change in your work.

## Copy this checklist into each meaningful PR

```markdown
## Problem
What user need or bug does this address?

## Change
What changed, and why?

## Verification
- [ ] Relevant checks passed.
- [ ] Affected behaviour was exercised.
- [ ] Tests were added or updated where useful.
- [ ] Documentation or examples were updated if needed.

## Related issue
Link, if applicable.

## Review
- [ ] Feedback is resolved or documented.
- [ ] The change is ready to merge.
```

## Keep beside you while developing

**Real need → issue when useful → branch → implementation → verification → PR → review → merge → release when ready → user feedback → maintenance.**

- Build useful functionality instead of creating empty activity.
- Keep each change logically complete; avoid duplicate issues and artificial PR splitting.
- Keep private commercial work private and publish only the intended public scope.
- Record actual authorship and leadership; owning a repository does not make every contribution yours.
- Treat audience growth, ecosystem impact and account maturity as outcomes that develop over time.
- Use the score as feedback about the public footprint, not as a substitute for project usefulness.

## References

- [GHFind methodology](https://ghfind.com/en/methodology)
- [GHFind scoring implementation](https://github.com/hikariming/ghfind/blob/main/src/lib/score.ts)
- [GHFind public-data limitation](https://github.com/hikariming/ghfind#disclaimer)
- [GitHub account types and contribution attribution](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)

Prepared for Empiric on 21 October 2026. Recheck the current scoring rules when interpreting future scans.

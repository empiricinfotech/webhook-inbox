# Foundation CI

D03.3 | 29 October 2026

[Foundation CI](../.github/workflows/ci.yml) runs on every pull request (including
fork PRs), pushes to main and manual workflow_dispatch. Pull requests check the
proposed merge with the target branch. There are no path filters that could
silently omit a documentation or tooling change. One Ubuntu 24.04 x64 job runs
these gates in order; any unexpected failure stops it:

1. Checkout; exact Node 24.22.0 from .nvmrc and bundled npm 11.19.1 from package.json.
2. npm run bootstrap (npm ci), followed by check:dependencies.
3. npm run lint and npm run typecheck.
4. Official MongoDB 8.0.32 native binary, verified against its pinned SHA-256.
5. npm test (unit and API projects) and npm run check:ci-contract-gate.
6. npm run check:foundation and npm run check:mongo.
7. npm run build: shared contracts, separate Express backend and Next production build.
8. npm run check:compiled-api and npm run check:routing.
9. git diff --check, no tracked modifications or untracked generated clutter.

The legacy checks supplement the fast suite instead of silently dropping earlier
coverage. The worker has no runtime implementation/build yet; no placeholder
worker success is claimed. No application architecture, dependencies, lockfile,
normal database or real environment values are changed for this task.

## Permissions and isolation

The workflow has only contents:read permission, no repository secrets, no write
operations, no pull_request_target trigger and no persistent checkout credential.
Both official actions are pinned to reviewed release commit SHAs. Automatic npm
caching is disabled; each runner installs from the frozen lockfile. Per-ref/PR
concurrency cancels superseded runs and the job has a 20-minute timeout.
Repository branch protection is unchanged; running checks does not itself make
them required by a protection rule. Fork runs may need GitHub's maintainer approval.

Mongo is downloaded to RUNNER_TEMP, not installed globally or started as a shared
service. The fixed official Ubuntu 24.04 archive checksum is committed in the
workflow and must be reverified against MongoDB when updating. MONGOD_BINARY
points fixtures to that binary. Tests create and clean their own loopback
processes, temporary directories and synthetic databases. No development Mongo
URI, volume, environment file, capture payload or secret is copied/uploaded.
There is no artifact publication, deployment, release or dependency upgrade.

## Contract gate acceptance

```bash
npm run check:ci-contract-gate
```

Run this acceptance probe in a disposable source checkout after bootstrap, with
native MongoDB 8 available, and without concurrent test/check commands. The
[probe](../scripts/check-ci-contract-gate.mjs) creates an exclusively owned,
uniquely named test under tests/unit. It exercises the actual identifier schema
with a deliberately wrong canonicalization expectation, then runs the real
npm test command with a temporary JSON report.

RED requires a nonzero normal exit and exactly the intended assertion failure;
startup errors, missing tests and unrelated failures cannot satisfy it. It then
corrects the expectation and requires a zero exit, no failing tests and a passed
result for that exact assertion. GREEN therefore covers the corrected assertion
and the entire normal suite. finally removes the probe/report directory on
success or failure. Existing tests and product source are never modified.

The normal npm test step must independently pass; no continue-on-error or blanket
failure suppression is used. The probe prints the real failing assertion and
RED/GREEN evidence. Its overall success means the rejection and correction
behaved as expected; it does not label the deliberately invalid assertion as a
passing test. The failing probe is generated only during verification.

Publication/hosted-run evidence is recorded in [implementation progress](IMPLEMENTATION_PROGRESS.md).
A configured YAML file or a local success alone is not evidence of a hosted CI run.

## Local reproduction and limitations

Use the pinned Node/npm and [testing instructions](TESTING.md). From a clean
source checkout, run the commands listed above; use native mongod or MONGOD_BINARY.
The workflow's Mongo archive targets Ubuntu 24.04 x64 only. Local production
build verification may bound Next worker count with CIRCLE_NODE_TOTAL=2 on a
resource-limited host; CI uses the hosted runner's normal worker configuration.

Browser UI, later capture/auth/tenant/replay journeys, release gates and
independent review are outside this CI foundation increment. The existing
body-parser advisory in [TOOLCHAIN.md](TOOLCHAIN.md#26-october-2026-audit-finding-d031)
remains a recorded finding; this workflow does not claim an audit-free dependency
tree or silently weaken an audit gate (none was previously required).

Primary references: [checkout release](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-node release](https://github.com/actions/setup-node/releases/tag/v7.1.0),
[GitHub pull_request semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request),
[MongoDB Ubuntu install requirements](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu-tarball/),
[official archive checksum](https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.32.tgz.sha256).

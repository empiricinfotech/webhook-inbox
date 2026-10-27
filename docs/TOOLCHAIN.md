# Toolchain and dependency baseline

D01.3 | Verified 21 October 2026 | Linux x64

This records the D01.3 dependency/bootstrap baseline. D02.1 subsequently adds the application shell and startup checks documented in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); D02.2 adds the Mongo connection/health checks documented in [MONGODB_LOCAL.md](MONGODB_LOCAL.md); capture remains pending.

## Runtime and package manager

| Tool | Exact version | Where recorded |
|---|---|---|
| Node.js | 24.22.0 | `.nvmrc`, `.node-version`, root `engines.node` and `devEngines.runtime` |
| npm | 11.19.1 | Root `packageManager`, `engines.npm` and `devEngines.packageManager` |
| Lockfile | npm lockfileVersion 3 | `package-lock.json` |

Node 24 is the plan's LTS line. Version 24.22.0 was the latest Node 24 LTS release in the official release index when checked; its official distribution bundles npm 11.19.1. The npm version is deliberately the tested bundled version, rather than an unpinned latest version.

Install this Node/npm pair using an existing version manager or the [official Node.js distribution](https://nodejs.org/dist/v24.22.0/). For an existing nvm installation, run `nvm install` and `nvm use` in the repository. These commands read `.nvmrc`. No version-manager installer or global tool configuration is changed by this repository.

If an existing Node installation has a different npm version, restore the bundled npm or install npm 11.19.1 outside this checkout using your version manager or `npm install --global npm@11.19.1`. Recheck both versions before bootstrap. Do not use `--force` or legacy peer resolution to bypass the pins.

## Bootstrap and current checks

From the repository root, after activating the pinned toolchain:

```bash
node --version
npm --version
npm run bootstrap
npm run check:toolchain
npm run check:dependencies
```

Expected versions are `v24.22.0` and `11.19.1`.

- `bootstrap` runs `npm ci`, installing all workspaces from the committed lockfile without rewriting it.
- `check:toolchain` prints the runtime/manager versions after npm's `devEngines` checks.
- `check:dependencies` runs `npm ls --all` and synthetic in-memory import/behavior checks in `scripts/check-dependencies.mjs`.
- `.npmrc` enforces engines and strict peer resolution and saves new direct dependencies as exact versions.
- npm's version-bound `allowScripts` entry covers `esbuild@0.28.2` for tsx; no blanket lifecycle-script allowance is used.
- All six workspaces and the root are `private` npm packages to prevent accidental package publication. This does not alter GitHub repository visibility.

Do not omit optional dependencies: Next.js, Tailwind and TypeScript use platform-specific packages. `npm ls --all` can show **UNMET OPTIONAL DEPENDENCY** for other platforms, which is expected; missing required dependencies, invalid peers or a nonzero exit status are not accepted.

## Exact foundation packages

All direct dependencies are exact versions, with transitive resolutions and integrity values in the lockfile.

| Package | Version | Workspace / purpose |
|---|---|---|
| next | 16.4.2 | web: Next.js App Router framework |
| react / react-dom | 19.3.1 / 19.3.1 | web: rendering; matching versions satisfy React DOM and Next peers |
| @tanstack/react-query | 5.104.5 | web: future Client Component server-state helpers |
| tailwindcss / @tailwindcss/postcss | 4.3.3 / 4.3.3 | web: future styling integration |
| postcss | 8.5.31 | web: CSS transformation |
| @types/react / @types/react-dom | 19.3.0 / 19.3.0 | web: matching React 19 type declarations |
| express / @types/express | 5.3.0 / 5.0.6 | api: Express 5 runtime and type declarations |
| mongoose | 9.11.2 | api, worker: Mongo library (API connection added in D02.2) |
| zod | 4.6.7 | api, web, worker, contracts: shared validation (web added in D02.1) |
| pino | 10.4.0 | api, worker: logging library |
| typescript | 7.0.2 | root: compiler shared by workspaces |
| @types/node | 24.19.2 | root: Node 24 declarations, rather than current Node 26 types |
| tsx | 4.23.15 | root: TypeScript execution for later startup tooling |

The test-data workspace is registered with no dependencies or fixtures. D02.1 now adds shared environment exports, TypeScript configurations, Next.js pages, Express startup and foundation checks. D02.2 adds the API Mongo connection, health routes and isolated native-Mongo checks; the broader application test harness remains later work. Dependencies for later authentication, tests or deployment are introduced only when needed.

Package engine requirements fit Node 24.22.0: Next.js requires at least Node 20.9.0, Express at least Node 18 and Mongoose at least Node 20.19.0 in the inspected registry metadata. Next.js accepts React 19, React DOM's React range includes 19.3.1, and TanStack Query accepts React 19. Strict npm resolution checked the complete installed graph.

## Verification evidence and limits

1. Downloaded the official Node 24.22.0 Linux x64 archive into a temporary folder and verified its published SHA-256. Used the bundled npm 11.19.1; global Node/npm installations were not changed.
2. Generated the lockfile with `npm install` under strict engine and peer checks. Installed 164 packages; the initial and clean installs each audited 170 packages and reported zero vulnerabilities at verification time. This is a dated registry audit result, not a guarantee about future advisories.
3. Copied only the manifests, configuration, lockfile and smoke script into a fresh temporary directory. `npm run bootstrap`, `npm run check:toolchain`, `npm run check:dependencies` and a tsx TypeScript execution check passed.
4. Lockfile SHA-256 before and after the clean install was unchanged: `fa44a2b15688e531819e880753d4352a00011bdae6e5e15716100687f9a74246`.
5. Wrong Node 22.22.2 and wrong npm 11.19.0 were each rejected with `EBADDEVENGINES`. A deliberately inconsistent temporary lockfile was rejected with `EUSAGE`; real project files were unchanged.
6. A temporary strict TypeScript fixture combined React/React DOM, Next config types, Express request types, Mongoose, Zod, Pino, QueryClient and Tailwind/PostCSS. It passed with `skipLibCheck: false`, Bundler module resolution and ES2024/DOM library definitions.
7. A separate temporary Next.js App Router fixture passed `next build --webpack`, including compilation, TypeScript and static generation, with one worker. No fixture route or Next config was copied into the project.
8. Runtime smoke checks exercised escaped React rendering, the Next.js factory import, a query-cache round trip, Tailwind/PostCSS output, Express Router construction, in-memory Mongoose validation, Zod parsing, Pino output and worker/contracts dependency resolution. No service or Mongo connection was started.

The first strict type fixture used ES2022 library definitions and exposed Next.js declarations requiring `PromiseWithResolvers`. Using ES2024 definitions resolved the missing ambient type; it was not hidden with `skipLibCheck`. D02.1 should use appropriate modern frontend library definitions (ES2024 or Next.js's ESNext defaults) when it introduces project TypeScript configuration.

Verification applies to the selected package/toolchain combination on Linux x64. The production build above uses an isolated fixture and webpack; it does not establish project UI behavior, production deployment, Turbopack behavior, cross-platform installation or any release milestone. D02.1 shell build and foundation-check evidence is recorded separately in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

## Updating this baseline

Use the pinned toolchain to change only dependencies required by the current task. Inspect engines/peers and dependency licenses, regenerate the lockfile, rerun clean bootstrap and relevant smoke/application checks, and update this document. TypeScript uses Apache-2.0; the other selected direct packages report MIT in the inspected registry metadata. Dependencies retain their own licenses; the repository's MIT license does not replace them.

Keep the lockfile, all affected workspace manifests and script-policy changes in the same coherent commit. Preserve `node_modules/`, caches, temporary fixtures, native binaries and real configuration values outside version control.

## Sources

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases) and [release index](https://nodejs.org/dist/index.json).
- [Next.js installation requirements](https://nextjs.org/docs/app/getting-started/installation).
- [Express installation requirements](https://expressjs.com/en/starter/installing/).
- [npm package metadata / devEngines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) and [npm configuration](https://docs.npmjs.com/cli/v11/using-npm/config/).
- Exact-version engine, peer and license metadata from the [npm registry](https://registry.npmjs.org/), inspected during this task; manifests and the lockfile identify the selected versions.

## D02.1 workspace update

API and web now depend on the private contracts workspace at exact version 0.0.0. Web directly declares Zod 4.6.7 for its environment schema. The lockfile records these links; no external package resolution or version changed. The D01.3 lock hash above is historical; the updated D02.1 lock is verified through a frozen install.

## D02.3 tooling update

Verified 23 October 2026. Application/runtime package pins and the root
TypeScript 7.0.2 compiler remain unchanged. A sixth private workspace,
`packages/lint-config`, isolates tooling with these exact dev dependencies:

| Package | Version | Purpose |
|---|---|---|
| eslint / @eslint/js | 10.13.0 / 10.0.1 | Supported flat-config CLI and JS rules |
| typescript-eslint | 8.72.0 | Recommended TypeScript syntax rules |
| typescript | 6.0.3 | Parser-only JS compiler API, isolated from application compiler 7 |
| eslint-plugin-react-hooks | 7.1.1 | React Hooks recommended rules |
| globals | 16.5.0 | Node/browser globals |

The lint parser declares TypeScript >=4.8.4 <6.1.0; TypeScript 7's native
compiler does not provide that JS parser API. Nested lint dependencies preserve
strict peers and let application/build commands continue using TypeScript 7.
The root lint launcher resolves the workspace CLI explicitly. The committed
lockfile preserves this placement; normal `npm ci` needs no install flags.
When intentionally regenerating lint dependencies, use the pinned npm with
`npm install --workspace=@empiric-webhook-inbox/lint-config --install-strategy=nested`.
Do not force or disable peer checks.

The full Next ESLint preset is deliberately not installed: its legacy React/a11y
plugin peers reject ESLint 10 under strict resolution, and the version-matched
Next plugin introduces unpatched braces advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The selected JS/TS/Hooks rules, strict Next types/build and browser verification
cover this increment. Next-specific lint rules and automated accessibility
rules are not claimed; revisit the preset once its dependency constraints and
advisory are resolved. No advisory suppression or dependency override is used.

New tooling packages report MIT, except TypeScript (Apache-2.0). Engines fit
the pinned Node runtime. Frozen installation, dependency smoke, lint, strict
typecheck, production builds and source/compiled API and routing checks are
recorded in [the progress log](IMPLEMENTATION_PROGRESS.md). npm audit reports
zero vulnerabilities for the final selected graph at verification time.
Historical audit results and hashes above describe their original commits.

## 26 October 2026 audit finding (D03.1)

D03.1 adds no dependency and leaves the lockfile and all package pins unchanged.
Clean installation and a fresh `npm audit --json` now report one high-severity
advisory in the existing Express transitive `body-parser@2.3.0`:
[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
The upstream advisory identifies compressed-body inflation as the affected
usage and lists 2.4.0 as patched. The current API installs no body-parser,
express.json or urlencoded middleware; this task preserves original-byte capture
boundaries. A compatible dependency refresh remains a maintenance finding to
resolve before adding parser middleware or a hosted release. No audit fix,
override, unrelated upgrade or zero-vulnerability claim is made for this run.
The zero-advisory results above are historical, dated observations.

## D03.2 test-tooling update

27 October 2026: exact root dev dependencies Vitest 5.0.5, Vite 8.3.5,
Supertest 7.3.1 and @types/supertest 7.2.1 added after inspecting registry engines,
peers and MIT licenses. Vitest accepts Node 24 and Vite 8; Vite's optional tsx,
esbuild and Node-types peers match the existing pinned packages. Application
versions and compiler/lint-parser separation are unchanged. npm deduplicated
four existing nested lint dependency entries to matching hoisted versions; no
pre-existing external package version was upgraded. The lockfile records all
new exact resolutions. Frozen bootstrap and strict dependency/type/build/test
checks are recorded in IMPLEMENTATION_PROGRESS. The previously recorded
body-parser advisory remains pending; no blanket audit fix or peer bypass used.

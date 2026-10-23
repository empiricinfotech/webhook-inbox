import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../packages/lint-config/package.json", import.meta.url));
const cli = join(dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
const result = spawnSync(process.execPath, [cli, ".", "--max-warnings=0"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

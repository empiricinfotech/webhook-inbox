import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "tests/mongo.test.ts",
], {
  env: { ...process.env, WEBHOOK_TEST_API_MODE: "compiled" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

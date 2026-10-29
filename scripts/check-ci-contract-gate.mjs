import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run only in a disposable checkout, without concurrent test/check commands.
// Real suites remain mandatory. This probe separately proves their failure gate.
const directory = await mkdtemp(join(tmpdir(), "webhook-contract-gate-"));
const probe = `tests/unit/ci-contract-gate-${randomUUID()}.test.ts`;
const report = join(directory, "report.json");
const title = "CI contract gate validates canonical identifiers";
const id = "0123456789abcdef01234567";
const source = (expected) => `import { test, expect } from "vitest";
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
test(${JSON.stringify(title)}, () => {
  expect(identifierSchema.parse(${JSON.stringify(id.toUpperCase())})).toBe(${JSON.stringify(expected)});
});
`;
const run = () => {
  const result = spawnSync("npm", ["test", "--", "--reporter=json", `--outputFile=${report}`], {
    encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, "Contract check must exit normally");
  return result;
};
let ownsProbe = false;
try {
  await writeFile(probe, source("synthetic-invalid-contract-expectation"), { flag: "wx" });
  ownsProbe = true;
  const invalid = run();
  assert.notEqual(invalid.status, 0, "The invalid contract assertion must fail the real test command");
  const red = JSON.parse(await readFile(report, "utf8"));
  assert.equal(red.numFailedTests, 1, "Only the intentional assertion may fail");
  const failures = red.testResults.flatMap((file) => file.assertionResults)
    .filter((test) => test.status === "failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].fullName, title);
  assert.match(failures[0].failureMessages.join("\n"), /synthetic-invalid-contract-expectation/);
  console.log(`RED: npm test exited ${invalid.status}; the intended contract assertion failed.`);
  console.log(failures[0].failureMessages.join("\n"));

  await writeFile(probe, source(id));
  await rm(report);
  const corrected = run();
  assert.equal(corrected.status, 0, `Corrected contract suite must pass:\n${corrected.stdout}\n${corrected.stderr}`);
  const green = JSON.parse(await readFile(report, "utf8"));
  assert.equal(green.numFailedTests, 0);
  const assertion = green.testResults.flatMap((file) => file.assertionResults)
    .find((test) => test.fullName === title);
  assert.equal(assertion?.status, "passed", "The corrected assertion must actually run");
  console.log(`GREEN: npm test exited 0; corrected assertion and all ${green.numPassedTests} tests passed.`);
} finally {
  if (ownsProbe) await rm(probe, { force: true });
  await rm(directory, { recursive: true, force: true });
}

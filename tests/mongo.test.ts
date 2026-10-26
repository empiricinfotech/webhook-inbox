import assert from "node:assert/strict";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  availablePort, launchApi, stopProcess, waitForApi,
} from "./helpers/api-process.js";

async function startMongo(directory: string, port: number) {
  const log = join(directory, "mongod.log");
  const child = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--dbpath", directory, "--bind_ip", "127.0.0.1", "--port", String(port),
    "--nounixsocket", "--logpath", log, "--logappend", "--quiet",
  ], { stdio: "ignore" });
  const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  // Attach a rejection handler immediately so a missing binary is reported cleanly.
  void exited.catch(() => {});
  const deadline = Date.now() + 15000;
  try {
    while (!(await readFile(log, "utf8").catch(() => "")).includes("Waiting for connections")) {
      assert.equal(child.exitCode, null, "mongod stopped before accepting connections");
      assert.ok(Date.now() < deadline, "mongod did not become ready; install MongoDB or set MONGOD_BINARY");
      await delay(50);
    }
    return { child, exited };
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

async function waitForHealth(base: string, status: number) {
  const deadline = Date.now() + 20000;
  while (true) {
    const response = await fetch(base + "/health/ready", { signal: AbortSignal.timeout(3000) });
    if (response.status === status) {
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        data: { status: status === 200 ? "ready" : "not_ready" },
      });
      return;
    }
    await response.body?.cancel();
    assert.ok(Date.now() < deadline, "readiness did not reach expected state");
    await delay(100);
  }
}

test("real Mongo startup, safe failures, outage/recovery and shutdown", {
  timeout: 90000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "webhook-mongo-check-"));
  const mongoPort = await availablePort();
  let mongo = await startMongo(directory, mongoPort);
  let api: ReturnType<typeof launchApi> | undefined;
  context.after(async () => {
    if (api) await stopProcess(api.child);
    await stopProcess(mongo.child);
    await rm(directory, { recursive: true, force: true });
  });
  const uri = `mongodb://127.0.0.1:${mongoPort}/webhook_inbox_check`;
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;

  await context.test("waits for real Mongo, exposes healthy responses and closes failed bind connections", async () => {
    api = launchApi({ API_PORT: String(port), MONGODB_URI: uri });
    await waitForApi(api);
    await waitForHealth(base, 200);
    const live = await fetch(base + "/health/live");
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { data: { status: "live" } });
    const missing = await fetch(base + "/api/v1/inboxes", {
      headers: { "X-Request-Id": "synthetic-untrusted-id" },
    });
    const body = apiErrorResponseSchema.parse(await missing.json());
    assert.equal(missing.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.requestId, missing.headers.get("x-request-id"));
    assert.notEqual(body.error.requestId, "synthetic-untrusted-id");
    assert.doesNotMatch(api.output(), /mongodb:\/\/|webhook_inbox_check/);

    const conflict = launchApi({ API_PORT: String(port), MONGODB_URI: uri });
    try {
      assert.equal((await conflict.exited)[0], 1);
      assert.match(conflict.output(), /EADDRINUSE/);
      assert.doesNotMatch(conflict.output(), /mongodb:\/\/|webhook_inbox_check/);
    } finally {
      await stopProcess(conflict.child);
    }
  });

  await context.test("authentication and URI-parser errors never expose connection details", async () => {
    for (const suffix of ["?authSource=admin", "?syntheticSecretOption=synthetic-option-value"]) {
      const failed = launchApi({
        API_PORT: String(await availablePort()),
        MONGODB_URI: `mongodb://synthetic-user:synthetic-password@127.0.0.1:${mongoPort}/synthetic-db${suffix}`,
      });
      try {
        assert.equal((await failed.exited)[0], 1);
        assert.match(failed.output(), /MONGODB_CONNECTION_FAILED/);
        assert.doesNotMatch(failed.output(),
          /synthetic-user|synthetic-password|synthetic-db|synthetic-option-value|127\.0\.0\.1|mongodb:\/\/|API listening/);
      } finally {
        await stopProcess(failed.child);
      }
    }
  });

  await context.test("a stalled database fails readiness within a bounded ping while liveness stays 200", async () => {
    mongo.child.kill("SIGSTOP");
    try {
      const started = Date.now();
      const response = await fetch(base + "/health/ready", { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { data: { status: "not_ready" } });
      assert.ok(Date.now() - started < 2500, "readiness ping exceeded its bounded budget");
      assert.equal((await fetch(base + "/health/live")).status, 200);
    } finally {
      mongo.child.kill("SIGCONT");
    }
    await waitForHealth(base, 200);
  });

  await context.test("Mongo outage fails readiness, startup failure stays private and reconnect recovers", async () => {
    mongo.child.kill("SIGTERM");
    assert.equal((await mongo.exited)[0], 0);
    await waitForHealth(base, 503);
    assert.equal((await fetch(base + "/health/live")).status, 200);
    const failedPort = await availablePort();
    const failed = launchApi({
      API_PORT: String(failedPort),
      MONGODB_URI: `mongodb://synthetic-user:synthetic-password@127.0.0.1:${mongoPort}/synthetic-db`,
    });
    try {
      assert.equal((await failed.exited)[0], 1);
      assert.match(failed.output(), /MONGODB_CONNECTION_FAILED/);
      assert.doesNotMatch(failed.output(), /synthetic-user|synthetic-password|synthetic-db|127\.0\.0\.1|API listening/);
      await assert.rejects(fetch(`http://127.0.0.1:${failedPort}/health/live`));
    } finally {
      await stopProcess(failed.child);
    }
    // Reuse only this test's isolated directory/port, never a user's database.
    await rm(join(directory, "mongod.log"), { force: true });
    mongo = await startMongo(directory, mongoPort);
    await waitForHealth(base, 200);
  });

  await context.test("SIGTERM closes HTTP and Mongo pools so the API exits cleanly", async () => {
    assert.ok(api);
    api.child.kill("SIGTERM");
    assert.equal((await api.exited)[0], 0);
    assert.match(api.output(), /API stopping/);
    assert.doesNotMatch(api.output(), /mongodb:\/\/|webhook_inbox_check/);
    await assert.rejects(fetch(base + "/health/live"));
  });
});

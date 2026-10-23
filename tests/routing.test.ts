import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
import nextConfig from "../apps/web/next.config.ts";
import { readWebEnvironment } from "../apps/web/src/lib/environment.js";
import { availablePort, stopProcess } from "./helpers/api-process.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));

test("development API origin is required, normalized and rejects credentials/paths/non-loopback targets", () => {
  assert.equal(readWebEnvironment({ API_ORIGIN: "http://127.0.0.1:4000/" }, true).API_ORIGIN,
    "http://127.0.0.1:4000");
  for (const value of [
    undefined, "", "https://example.com", "http://127.0.0.1:4000/path",
    "http://synthetic-user:synthetic-password@127.0.0.1:4000",
    "http://127.0.0.1:4000/?query=synthetic-secret", "http://127.0.0.1:4000/#fragment",
  ]) {
    const source = value === undefined ? {} : { API_ORIGIN: value };
    assert.throws(() => readWebEnvironment(source, true),
      /^EnvironmentConfigurationError: Invalid environment configuration: API_ORIGIN$/);
  }
});

test("the actual Next configuration rewrites only management API paths during development", async (context) => {
  const previous = process.env.API_ORIGIN;
  context.after(() => {
    if (previous === undefined) delete process.env.API_ORIGIN;
    else process.env.API_ORIGIN = previous;
  });
  process.env.API_ORIGIN = "http://127.0.0.1:4000";
  const development = nextConfig(PHASE_DEVELOPMENT_SERVER);
  assert.ok(development.rewrites);
  assert.deepEqual(await development.rewrites(), [{
    source: "/api/v1/:path*", destination: "http://127.0.0.1:4000/api/v1/:path*",
  }]);
  delete process.env.API_ORIGIN;
  const production = nextConfig(PHASE_PRODUCTION_BUILD);
  assert.ok(production.rewrites);
  assert.deepEqual(await production.rewrites(), []);
  assert.throws(() => nextConfig(PHASE_DEVELOPMENT_SERVER), /API_ORIGIN/);
});

test("real Next development proxy preserves methods/query/body/cookies/status and excludes capture/health", {
  timeout: 90000,
}, async (context) => {
  // A transport fixture proves forwarding without adding future product API routes.
  const received: Array<{ method: string | undefined; url: string | undefined; body: string; cookie: string | undefined }> = [];
  const backend = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({
      method: request.method, url: request.url, body: Buffer.concat(chunks).toString(),
      cookie: request.headers.cookie,
    });
    response.writeHead(207, {
      "Content-Type": "application/json", "X-Synthetic-Backend": "routing-fixture",
      "Set-Cookie": "synthetic_session=fixture; Path=/; HttpOnly; SameSite=Lax",
    });
    response.end(JSON.stringify({ synthetic: true }));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const backendAddress = backend.address();
  assert.ok(backendAddress && typeof backendAddress !== "string");
  const fixture = await mkdtemp(join(tmpdir(), "webhook-routing-"));
  const resources: { next?: ReturnType<typeof spawn> } = {};
  context.after(async () => {
    const next = resources.next;
    if (next) {
      if (next.exitCode === null && next.signalCode === null) {
        const exited = once(next, "exit");
        next.kill("SIGINT");
        await Promise.race([exited, delay(5000)]);
      }
      await stopProcess(next);
    }
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(fixture, { recursive: true, force: true });
  });
  for (const name of [
    "package.json", "package-lock.json", "tsconfig.base.json", "apps/web/package.json",
    "apps/web/tsconfig.json", "apps/web/next.config.ts", "apps/web/postcss.config.mjs", "apps/web/src",
  ]) {
    await mkdir(dirname(join(fixture, name)), { recursive: true });
    await cp(join(root, name), join(fixture, name), { recursive: true });
  }
  // Reuse installed dependencies, never copy the caller's environment files.
  await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
  const port = await availablePort();
  let output = "";
  const next = resources.next = spawn(process.execPath, [web.resolve("next/dist/bin/next"), "dev", "--webpack",
    "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: join(fixture, "apps/web"),
    env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      API_ORIGIN: `http://127.0.0.1:${backendAddress.port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  next.stdout?.on("data", (chunk) => { output += chunk; });
  next.stderr?.on("data", (chunk) => { output += chunk; });
  const front = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45000;
  while (!output.includes("Ready in")) {
    assert.equal(next.exitCode, null, output);
    assert.ok(Date.now() < deadline, output);
    await delay(50);
  }
  const body = '{ "synthetic": true, "text": "safe sample" }';
  for (const [method, path, payload] of [
    ["GET", "/api/v1", undefined],
    ["GET", "/api/v1/inboxes?limit=1&cursor=a%2Fb", undefined],
    ["POST", "/api/v1/workspaces?filter=x", body],
  ] as const) {
    const response = await fetch(front + path, {
      method, ...(payload === undefined ? {} : { body: payload }),
      headers: { "Content-Type": "application/json", Cookie: "synthetic_session=input" },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 207);
    assert.equal(response.headers.get("x-synthetic-backend"), "routing-fixture");
    assert.match(response.headers.get("set-cookie") || "", /synthetic_session=fixture/);
    assert.deepEqual(await response.json(), { synthetic: true });
    assert.deepEqual(received.at(-1), {
      method, url: path, body: payload || "", cookie: "synthetic_session=input",
    });
  }
  const count = received.length;
  for (const path of ["/capture/synthetic-token", "/health/live", "/api/v10/unmatched"]) {
    const response = await fetch(front + path, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 404);
    await response.body?.cancel();
  }
  assert.equal(received.length, count);
});

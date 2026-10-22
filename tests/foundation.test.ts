import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { useQueryClient } from "@tanstack/react-query";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readApiEnvironment } from "../apps/api/src/config/environment.js";
import { readWebEnvironment } from "../apps/web/src/lib/environment.js";
import { QueryProvider } from "../apps/web/src/lib/query-provider.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));

test("environment parsing accepts bounded ports, defaults to loopback and strips unrelated values", () => {
  assert.deepEqual(readApiEnvironment({ API_PORT: "4000", PRIVATE_VALUE: "synthetic" }), {
    NODE_ENV: "development", API_HOST: "127.0.0.1", API_PORT: 4000,
  });
  for (const port of ["1", "65535"]) {
    assert.equal(readApiEnvironment({ API_PORT: port }).API_PORT, Number(port));
  }
  assert.equal(readApiEnvironment({ API_PORT: "4000", API_HOST: "::1" }).API_HOST, "::1");
  assert.deepEqual(readWebEnvironment({ NODE_ENV: "production", PRIVATE_VALUE: "synthetic" }), {
    NODE_ENV: "production",
  });
});

test("missing/invalid ports and non-loopback hosts fail without returning input values", () => {
  for (const port of [undefined, "", "0", "-1", "65536", "4.5", "4e3", " 4000 ", "synthetic-private-value"]) {
    const source = port === undefined ? {} : { API_PORT: port };
    assert.throws(() => readApiEnvironment(source), (error: unknown) =>
      error instanceof EnvironmentConfigurationError &&
      error.message === "Invalid environment configuration: API_PORT");
  }
  assert.throws(() => readApiEnvironment({ API_PORT: "4000", API_HOST: "0.0.0.0" }),
    /Invalid environment configuration: API_HOST/);
  assert.throws(() => readWebEnvironment({ NODE_ENV: "synthetic-private-value" }),
    /^EnvironmentConfigurationError: Invalid environment configuration: NODE_ENV$/);
});

test("the real query provider supplies an isolated cache to each server-rendered tree", () => {
  const { createElement } = web("react");
  const { renderToString } = web("react-dom/server");
  const clients = new Set<object>();
  function Consumer() {
    const client = useQueryClient();
    assert.equal(client.getQueryData(["synthetic"]), undefined);
    client.setQueryData(["synthetic"], "local");
    clients.add(client);
    return createElement("span", null, client.getQueryData(["synthetic"]));
  }
  for (let index = 0; index < 2; index++) {
    assert.equal(renderToString(createElement(QueryProvider, null, createElement(Consumer))),
      "<span>local</span>");
  }
  assert.equal(clients.size, 2);
});

function launch(extra: Record<string, string | undefined>) {
  const env = { ...process.env };
  delete env.API_PORT;
  delete env.API_HOST;
  env.NODE_ENV = "test";
  Object.assign(env, extra);
  const child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  return { child, exited, output: () => output };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("API startup rejects missing/invalid configuration with exit code 1 and sanitized logs", {
  timeout: 15000,
}, async (context) => {
  for (const extra of [{}, { API_PORT: "synthetic-private-value" }, { API_PORT: "4000", NODE_ENV: "synthetic-private-value" }]) {
    const api = launch(extra);
    context.after(() => stop(api.child));
    assert.equal((await api.exited)[0], 1);
    assert.match(api.output(), /Invalid environment configuration/);
    assert.doesNotMatch(api.output(), /synthetic-private-value|API listening/);
  }
});

test("API starts, returns safe 404s without echoing request data, rejects occupied ports and shuts down", {
  timeout: 15000,
}, async (context) => {
  const port = await availablePort();
  const api = launch({ API_PORT: String(port) });
  context.after(() => stop(api.child));
  const deadline = Date.now() + 10000;
  while (!api.output().includes("API listening")) {
    assert.equal(api.child.exitCode, null, api.output());
    assert.ok(Date.now() < deadline, "API did not start in time");
    await delay(25);
  }
  for (const path of ["/", "/health/live", "/api/v1/inboxes", "/capture/synthetic-private-value"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { authorization: "Bearer synthetic-private-value" },
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(await response.text(), "Not found\n");
  }
  const conflicting = launch({ API_PORT: String(port) });
  context.after(() => stop(conflicting.child));
  assert.equal((await conflicting.exited)[0], 1);
  assert.match(conflicting.output(), /EADDRINUSE/);
  assert.doesNotMatch(conflicting.output(), /API listening/);

  api.child.kill("SIGTERM");
  assert.equal((await api.exited)[0], 0);
  assert.match(api.output(), /API stopping/);
  assert.doesNotMatch(api.output(), /synthetic-private-value/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

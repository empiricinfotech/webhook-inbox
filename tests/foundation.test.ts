import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { useQueryClient } from "@tanstack/react-query";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readApiEnvironment } from "../apps/api/src/config/environment.js";
import { startServer } from "../apps/api/src/server.js";
import { readWebEnvironment } from "../apps/web/src/lib/environment.js";
import { QueryProvider } from "../apps/web/src/lib/query-provider.js";
import { availablePort, launchApi, stopProcess } from "./helpers/api-process.js";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const uri = "mongodb://127.0.0.1:27017/webhook_inbox_test";

test("environment parsing accepts bounded ports, defaults to loopback and strips unrelated values", () => {
  assert.deepEqual(readApiEnvironment({ API_PORT: "4000", MONGODB_URI: uri, PRIVATE_VALUE: "synthetic" }), {
    NODE_ENV: "development", MONGODB_URI: uri, API_HOST: "127.0.0.1", API_PORT: 4000,
  });
  for (const port of ["1", "65535"]) {
    assert.equal(readApiEnvironment({ API_PORT: port, MONGODB_URI: uri }).API_PORT, Number(port));
  }
  assert.equal(readApiEnvironment({ API_PORT: "4000", MONGODB_URI: uri, API_HOST: "::1" }).API_HOST, "::1");
  assert.deepEqual(readWebEnvironment({ NODE_ENV: "production", PRIVATE_VALUE: "synthetic" }), {
    NODE_ENV: "production",
  });
});

test("missing/invalid ports, Mongo URIs and non-loopback hosts fail without returning values", () => {
  for (const port of [undefined, "", "0", "-1", "65536", "4.5", "4e3", " 4000 ", "synthetic-private-value"]) {
    const source = port === undefined ? { MONGODB_URI: uri } : { API_PORT: port, MONGODB_URI: uri };
    assert.throws(() => readApiEnvironment(source), (error: unknown) =>
      error instanceof EnvironmentConfigurationError &&
      error.message === "Invalid environment configuration: API_PORT");
  }
  for (const value of [undefined, "", "https://synthetic-private-value", "mongodb://bad value"]) {
    const source = value === undefined ? { API_PORT: "4000" } : { API_PORT: "4000", MONGODB_URI: value };
    assert.throws(() => readApiEnvironment(source), (error: unknown) =>
      error instanceof EnvironmentConfigurationError &&
      error.message === "Invalid environment configuration: MONGODB_URI");
  }
  assert.throws(() => readApiEnvironment({ API_PORT: "4000", MONGODB_URI: uri, API_HOST: "0.0.0.0" }),
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

test("API startup rejects missing/invalid configuration with exit code 1 and sanitized logs", {
  timeout: 15000,
}, async (context) => {
  for (const extra of [
    {},
    { API_PORT: "4000" },
    { API_PORT: "synthetic-private-value", MONGODB_URI: uri },
    { API_PORT: "4000", MONGODB_URI: uri, NODE_ENV: "synthetic-private-value" },
    { API_PORT: "4000", MONGODB_URI: "https://synthetic-private-value" },
  ]) {
    const api = launchApi(extra);
    context.after(() => stopProcess(api.child));
    assert.equal((await api.exited)[0], 1);
    assert.match(api.output(), /Invalid environment configuration/);
    assert.doesNotMatch(api.output(), /synthetic-private-value|API listening|mongodb:\/\//);
  }
});

test("HTTP health separates liveness/readiness, handles probe errors safely and retains default 404s", {
  timeout: 10000,
}, async (context) => {
  const port = await availablePort();
  let ready = false;
  let failProbe = false;
  const environment = readApiEnvironment({ API_PORT: String(port), MONGODB_URI: uri });
  const probe = async () => {
    if (failProbe) throw new Error("synthetic-private-value");
    return ready;
  };
  const server = await startServer(environment, probe);
  context.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${port}`;
  const live = await fetch(base + "/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("cache-control"), "no-store");
  assert.equal(live.headers.get("x-powered-by"), null);
  assert.deepEqual(await live.json(), { data: { status: "live" } });
  for (const state of [false, true]) {
    ready = state;
    const response = await fetch(base + "/health/ready");
    assert.equal(response.status, state ? 200 : 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { data: { status: state ? "ready" : "not_ready" } });
  }
  failProbe = true;
  const failed = await fetch(base + "/health/ready");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { data: { status: "not_ready" } });
  assert.equal((await fetch(base + "/health/live")).status, 200);
  const head = await fetch(base + "/health/live", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const path of ["/", "/health", "/api/v1/inboxes", "/capture/synthetic-private-value"]) {
    const response = await fetch(base + path, { headers: { authorization: "Bearer synthetic-private-value" } });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found\n");
  }
  await assert.rejects(startServer(environment, probe), { code: "EADDRINUSE" });
});

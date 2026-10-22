import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function launchApi(extra: Record<string, string | undefined>) {
  const env = { ...process.env };
  delete env.API_PORT;
  delete env.API_HOST;
  delete env.MONGODB_URI;
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

export async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

export async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function waitForApi(api: ReturnType<typeof launchApi>) {
  const deadline = Date.now() + 15000;
  while (!api.output().includes("API listening")) {
    assert.equal(api.child.exitCode, null, api.output());
    assert.ok(Date.now() < deadline, "API did not start in time");
    await delay(25);
  }
}

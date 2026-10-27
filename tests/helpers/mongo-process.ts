import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopProcess } from "./api-process.js";

export async function startMongo(directory: string, port: number) {
  const log = join(directory, "mongod.log");
  const child = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--dbpath", directory, "--bind_ip", "127.0.0.1", "--port", String(port),
    "--nounixsocket", "--logpath", log, "--logappend", "--quiet",
  ], { stdio: "ignore" });
  const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  // Attach a rejection handler immediately so a missing binary is reported cleanly.
  void exited.catch(() => {});
  let failed = false;
  child.once("error", () => { failed = true; });
  const deadline = Date.now() + 15000;
  try {
    while (!(await readFile(log, "utf8").catch(() => "")).includes("Waiting for connections")) {
      assert.ok(!failed && child.exitCode === null, "Disposable Mongo could not start");
      assert.ok(Date.now() < deadline, "mongod did not become ready; install MongoDB or set MONGOD_BINARY");
      await delay(50);
    }
    return { child, exited };
  } catch {
    await stopProcess(child);
    throw new Error("Disposable Mongo startup failed; install MongoDB 8 or set MONGOD_BINARY");
  }
}

import { spawn } from "node:child_process";
import { resolve } from "node:path";

// No inherited app configuration or secret-bearing process errors in test diagnostics.
export async function runLocalInbox(cwd: string, args: string[], env: Record<string, string> = {}, compiled = false) {
  const entry = resolve(compiled ? "apps/api/dist/local-inbox.js" : "apps/api/src/local-inbox.ts");
  const child = spawn(process.execPath, ["--env-file-if-exists=.env.inbox.local",
    ...(compiled ? ["--no-experimental-strip-types"] : ["--import", resolve("node_modules/tsx/dist/loader.mjs")]), entry, ...args], {
    cwd, env: { PATH: process.env.PATH, NODE_ENV: "test", ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Local operator command timed out")); }, 12000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Local operator command failed to start")); });
    child.once("close", (code) => { clearTimeout(timer); resolveResult({ code, stdout, stderr }); });
  });
}

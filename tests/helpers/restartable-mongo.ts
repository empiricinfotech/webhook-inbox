import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";
import { availablePort } from "./api-process.js";
import { startMongo } from "./mongo-process.js";

// Owns this process, directory, port and random database; never reads caller config.
export async function createRestartableMongo() {
  const directory = await mkdtemp(join(tmpdir(), "webhook-restart-mongo-"));
  const connection = mongoose.createConnection();
  connection.on("error", () => {});
  let mongoProcess: Awaited<ReturnType<typeof startMongo>> | undefined;
  let closing: Promise<void> | undefined;
  const stop = async () => {
    const current = mongoProcess;
    if (!current || current.child.exitCode !== null || current.child.signalCode !== null) return;
    const timer = setTimeout(() => current.child.kill("SIGKILL"), 5000);
    try { current.child.kill("SIGTERM"); await current.exited; }
    finally { clearTimeout(timer); }
  };
  const close = () => closing ??= (async () => {
    try { await connection.close(); }
    finally { try { await stop(); } finally { await rm(directory, { recursive: true, force: true }); } }
  })();
  try {
    const port = await availablePort();
    mongoProcess = await startMongo(directory, port);
    const databaseName = `webhook_restart_${randomUUID().replaceAll("-", "")}`;
    const uri = `mongodb://127.0.0.1:${port}/${databaseName}`;
    await connection.openUri(uri, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000,
      heartbeatFrequencyMS: 500, autoCreate: false, autoIndex: false, bufferCommands: false });
    return { connection, uri, stop, close,
      async restart() {
        if (closing) throw new Error("Disposable Mongo fixture is closing");
        await stop();
        // startMongo reads its log for readiness; remove this owned log so an old
        // startup message cannot make a restart appear ready prematurely.
        await rm(join(directory, "mongod.log"), { force: true });
        mongoProcess = await startMongo(directory, port);
        const deadline = Date.now() + 10_000;
        while (true) {
          try { await connection.db!.command({ ping: 1 }, { timeoutMS: 1000 }); return; }
          catch {
            if (Date.now() >= deadline) throw new Error("Disposable Mongo did not reconnect");
            await delay(100);
          }
        }
      },
    };
  } catch {
    await close();
    throw new Error("Disposable restartable Mongo fixture setup failed");
  }
}

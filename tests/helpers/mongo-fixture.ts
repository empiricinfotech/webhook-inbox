import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { availablePort } from "./api-process.js";
import { startMongo } from "./mongo-process.js";

// No URI parameter, dotenv loading or MONGODB_URI read: this owns a new process/data directory.
export async function createMongoFixture() {
  const directory = await mkdtemp(join(tmpdir(), "webhook-test-fixture-"));
  const connection = mongoose.createConnection();
  connection.on("error", () => {});
  let mongoProcess: Awaited<ReturnType<typeof startMongo>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await connection.close();
    } finally {
      try {
        if (mongoProcess && mongoProcess.child.exitCode === null && mongoProcess.child.signalCode === null) {
          const timer = setTimeout(() => mongoProcess?.child.kill("SIGKILL"), 5000);
          try {
            mongoProcess.child.kill("SIGTERM");
            await mongoProcess.exited;
          } finally { clearTimeout(timer); }
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  })();
  try {
    const port = await availablePort();
    mongoProcess = await startMongo(directory, port);
    const databaseName = `webhook_test_${randomUUID().replaceAll("-", "")}`;
    const uri = `mongodb://127.0.0.1:${port}/${databaseName}`;
    await connection.openUri(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
      autoCreate: false, autoIndex: false, bufferCommands: false });
    return {
      uri, connection, directory, databaseName, close,
      async reset() {
        if (closing || connection.readyState !== 1) throw new Error("Test Mongo fixture is closed");
        // This connection belongs exclusively to the process and random database created above.
        await connection.dropDatabase();
      },
    };
  } catch {
    await close();
    throw new Error("Disposable Mongo fixture setup failed; install MongoDB 8 or set MONGOD_BINARY");
  }
}
export type MongoFixture = Awaited<ReturnType<typeof createMongoFixture>>;

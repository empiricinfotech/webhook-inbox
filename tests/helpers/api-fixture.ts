import { createServer } from "node:http";
import { test as baseTest } from "vitest";
import supertest from "supertest";
import { createApp } from "../../apps/api/src/app.js";
import { connectDatabase } from "../../apps/api/src/database.js";
import { createMongoFixture } from "./mongo-fixture.js";

export const test = baseTest
  // eslint-disable-next-line no-empty-pattern -- Vitest requires a destructured context for a fixture without dependencies.
  .extend("mongo", async ({}, { onCleanup }) => {
    const mongo = await createMongoFixture();
    onCleanup(mongo.close);
    return mongo;
  })
  .extend("api", async ({ mongo }, { onCleanup }) => {
    const database = await connectDatabase(mongo.uri);
    const server = createServer(createApp(() => database.isReady()));
    onCleanup(async () => {
      try {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally { await database.close(); }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    return { request: supertest(server), database, server };
  });

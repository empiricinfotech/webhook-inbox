import { expect, test, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMongoFixture } from "../helpers/mongo-fixture.js";

test("failed fixture startup rejects promptly and removes its temporary directory", async ({ onTestFinished }) => {
  const parent = await mkdtemp(join(tmpdir(), "webhook-startup-failure-"));
  onTestFinished(() => rm(parent, { recursive: true, force: true }));
  // This fork's temporary root prevents interference with fixtures running in other workers.
  vi.stubEnv("TMPDIR", parent);
  vi.stubEnv("MONGOD_BINARY", "/synthetic-missing-mongod");
  await expect(createMongoFixture()).rejects.toThrow("Disposable Mongo fixture setup failed");
  expect(await readdir(parent)).toEqual([]);
});

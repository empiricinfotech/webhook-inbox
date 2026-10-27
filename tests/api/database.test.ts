import { expect, vi } from "vitest";
import { access } from "node:fs/promises";
import { test } from "../helpers/api-fixture.js";
import { createMongoFixture } from "../helpers/mongo-fixture.js";
import { seedSyntheticRecords } from "../fixtures/synthetic-records.js";
import { apiErrorResponseSchema } from "@empiric-webhook-inbox/contracts/errors";
import { requestIdSchema } from "@empiric-webhook-inbox/contracts/identifiers";

test("Supertest reaches real-Mongo readiness and preserves health/error/HEAD contracts", async ({ api, mongo }) => {
  await seedSyntheticRecords(mongo);
  expect(await mongo.connection.collection("harness_records").countDocuments()).toBe(2);
  const ready = await api.request.get("/health/ready").expect(200);
  expect(ready.body).toEqual({ data: { status: "ready" } });
  requestIdSchema.parse(ready.headers["x-request-id"]);
  const missing = await api.request.get("/api/v1/inboxes")
    .set("X-Request-Id", "synthetic-untrusted").expect(404).expect("Cache-Control", "no-store");
  const body = apiErrorResponseSchema.parse(missing.body);
  expect(body.error.code).toBe("NOT_FOUND");
  expect(body.error.requestId).toBe(missing.headers["x-request-id"]);
  expect(body.error.requestId).not.toBe("synthetic-untrusted");
  const head = await api.request.head("/health/ready").expect(200);
  expect(head.text).toBeUndefined();
});

test("fixtures start empty and explicit reset permits repeatable synthetic seeding", async ({ mongo }) => {
  const records = mongo.connection.collection("harness_records");
  expect(await records.countDocuments()).toBe(0);
  await seedSyntheticRecords(mongo);
  expect(await records.find({}, { projection: { _id: 0 } }).sort({ value: 1 }).toArray()).toEqual([
    { label: "Synthetic alpha", value: 1 }, { label: "Synthetic beta", value: 2 },
  ]);
  await mongo.reset();
  expect(await records.countDocuments()).toBe(0);
  await seedSyntheticRecords(mongo);
  expect(await records.countDocuments()).toBe(2);
});

test("simultaneous fixtures isolate data; closing one removes only its own resources", async ({ mongo, onTestFinished }) => {
  const second = await createMongoFixture();
  onTestFinished(second.close);
  expect(second.uri).not.toBe(mongo.uri);
  expect(second.databaseName).not.toBe(mongo.databaseName);
  await seedSyntheticRecords(mongo);
  await seedSyntheticRecords(second);
  await second.reset();
  expect(await second.connection.collection("harness_records").countDocuments()).toBe(0);
  expect(await mongo.connection.collection("harness_records").countDocuments()).toBe(2);
  await second.close();
  await second.close();
  expect(second.connection.readyState).toBe(0);
  await expect(access(second.directory)).rejects.toThrow();
  expect(await mongo.connection.db!.command({ ping: 1 })).toHaveProperty("ok", 1);
  await expect(second.reset()).rejects.toThrow("Test Mongo fixture is closed");
});

test("closed application pool yields readiness 503 while liveness stays healthy", async ({ api }) => {
  await api.request.get("/health/ready").expect(200);
  await api.database.close();
  await api.request.get("/health/ready").expect(503, { data: { status: "not_ready" } });
  await api.request.get("/health/live").expect(200, { data: { status: "live" } });
});

test("fixture ignores caller database configuration and allocates a new owned target", async ({ onTestFinished }) => {
  vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:1/synthetic_protected_database");
  const mongo = await createMongoFixture();
  onTestFinished(mongo.close);
  expect(mongo.uri).not.toContain(":1/");
  expect(mongo.databaseName).toMatch(/^webhook_test_[0-9a-f]{32}$/);
  expect(await mongo.connection.db!.command({ ping: 1 })).toHaveProperty("ok", 1);
});

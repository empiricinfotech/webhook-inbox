import { randomBytes } from "node:crypto";
import { test, expect } from "vitest";
import { createInboxSchema, inboxSummarySchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readLocalInboxEnvironment } from "../../apps/api/src/config/local-inbox.js";

function config() {
  return { NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1:27017/synthetic?directConnection=true",
    LOCAL_OWNER_ID: "0123456789abcdef01234567", LOCAL_WORKSPACE_ID: "0123456789abcdef01234568",
    LOCAL_WORKSPACE_NAME: "Synthetic workspace", CAPTURE_TOKEN_KEY_VERSION: "test-v1",
    CAPTURE_TOKEN_KEY_HEX: randomBytes(32).toString("hex") };
}
test("creation contract bounds normalized input and rejects privilege/credential/mongo injection", () => {
  expect(createInboxSchema.parse({ name: " Synthetic " })).toEqual({ name: "Synthetic", description: "", retentionDays: 7 });
  expect(createInboxSchema.safeParse({ name: "x".repeat(100), description: "d".repeat(500), retentionDays: 30 }).success).toBe(true);
  for (const input of [null, [], {}, { name: " " }, { name: 1 }, { name: "x".repeat(101) },
    { name: "bad\nname" }, { name: "x", description: null }, { name: "x", description: "d".repeat(501) },
    { name: "x", description: "bad\u0000text" }, { name: { $ne: null } },
    { name: "x", retentionDays: "7" }, { name: "x", retentionDays: 2 },
    ...["workspaceId", "ownerId", "enabled", "tokenHash", "encryptedToken", "$set"].map((key) => ({ name: "x", [key]: true })),
  ]) expect(createInboxSchema.safeParse(input).success).toBe(false);
});
test("summary contract permits only safe serialized metadata", () => {
  const summary = { id: "0123456789abcdef01234567", workspaceId: "0123456789abcdef01234568",
    name: "Synthetic", description: "", retentionDays: 7, enabled: true,
    createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z" };
  expect(inboxSummarySchema.safeParse(summary).success).toBe(true);
  for (const key of ["tokenHash", "encryptedToken", "token", "captureUrl", "ownerId"]) {
    expect(inboxSummarySchema.safeParse({ ...summary, [key]: "synthetic" }).success).toBe(false);
  }
});
test("operator config permits explicit loopback databases and refuses production/discovery/system targets", () => {
  const valid = config();
  for (const uri of [valid.MONGODB_URI, "mongodb://[::1]:27017/synthetic", "mongodb://127.0.0.1/synthetic"]) {
    const parsed = readLocalInboxEnvironment({ ...valid, MONGODB_URI: uri });
    expect(parsed.LOCAL_WORKSPACE_ID).toBe(valid.LOCAL_WORKSPACE_ID);
    expect(new URL(parsed.MONGODB_URI).searchParams.get("directConnection")).toBe("true");
  }
  for (const uri of ["mongodb://localhost/synthetic", "mongodb+srv://127.0.0.1/synthetic", "mongodb://example.com/synthetic",
    "mongodb://127.0.0.1,example.com/synthetic", "mongodb://127.0.0.1/", "mongodb://127.0.0.1/admin",
    "mongodb://127.0.0.1/LOCAL", "mongodb://127.0.0.1/config", "mongodb://127.0.0.1/synthetic?replicaSet=x",
    "mongodb://127.0.0.1/synthetic?directConnection=false", "mongodb://127.0.0.1/synthetic#x",
  ]) expect(() => readLocalInboxEnvironment({ ...valid, MONGODB_URI: uri })).toThrow(EnvironmentConfigurationError);
  expect(() => readLocalInboxEnvironment({ ...valid, NODE_ENV: "production" })).toThrow(EnvironmentConfigurationError);
});
test("operator config fails closed without required IDs/keys and reports field names only", () => {
  const valid = config();
  for (const key of ["MONGODB_URI", "LOCAL_OWNER_ID", "LOCAL_WORKSPACE_ID", "LOCAL_WORKSPACE_NAME",
    "CAPTURE_TOKEN_KEY_VERSION", "CAPTURE_TOKEN_KEY_HEX"]) {
    expect(() => readLocalInboxEnvironment({ ...valid, [key]: undefined })).toThrow(EnvironmentConfigurationError);
  }
  const privateValue = randomBytes(32).toString("hex");
  for (const replacement of [{ LOCAL_OWNER_ID: { $ne: null } }, { CAPTURE_TOKEN_KEY_HEX: privateValue + "x" },
    { CAPTURE_TOKEN_KEY_VERSION: "bad version" }]) {
    try { readLocalInboxEnvironment({ ...valid, ...replacement } as unknown as Record<string, string>); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error instanceof EnvironmentConfigurationError).toBe(true);
      expect(String(error).includes(privateValue)).toBe(false);
      expect(Object.hasOwn(error as object, "cause")).toBe(false);
    }
  }
});

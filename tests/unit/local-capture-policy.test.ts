import { expect, test } from "vitest";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readLocalCapturePolicy } from "../../apps/api/src/config/local-dashboard.js";

test("local capture policy defaults safely and accepts a bounded trusted JSON-name list and body omission", () => {
  expect(readLocalCapturePolicy({})).toEqual({ captureBody: true, sensitiveJsonKeys: [] });
  expect(readLocalCapturePolicy({ LOCAL_CAPTURE_BODY: "false", LOCAL_SENSITIVE_JSON_KEYS: '["custom","a.b"]' }))
    .toEqual({ captureBody: false, sensitiveJsonKeys: ["custom", "a.b"] });
});

test("invalid local policy fails with field names, never configuration values", () => {
  for (const source of [
    { LOCAL_CAPTURE_BODY: "synthetic-private" }, { LOCAL_SENSITIVE_JSON_KEYS: "synthetic-private" },
    { LOCAL_SENSITIVE_JSON_KEYS: '[null]' }, { LOCAL_SENSITIVE_JSON_KEYS: JSON.stringify(["x".repeat(129)]) },
    { LOCAL_SENSITIVE_JSON_KEYS: JSON.stringify(Array(65).fill("x")) },
  ]) {
    try { readLocalCapturePolicy(source); throw new Error("Expected policy rejection"); }
    catch (error) {
      expect(error instanceof EnvironmentConfigurationError).toBe(true);
      expect(String(error).includes("synthetic-private")).toBe(false);
    }
  }
});

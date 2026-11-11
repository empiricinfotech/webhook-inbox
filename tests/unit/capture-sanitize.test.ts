import { Types } from "mongoose";
import { expect, test } from "vitest";
import { createCaptureSanitizer, MAX_CUSTOM_REDACTION_KEYS, MAX_REDACTION_KEY_LENGTH } from "../../apps/api/src/capture/sanitize.js";
import { MAX_JSON_DEPTH } from "../../apps/api/src/capture/prepare.js";
import { MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import type { RawCaptureInput } from "../../apps/api/src/routes/capture.js";

function input(text: string, type = "application/json"): RawCaptureInput {
  return { method: "POST", receivedAt: new Date("2026-11-11T09:00:00.000Z"),
    inbox: { inboxId: new Types.ObjectId(), workspaceId: new Types.ObjectId(), enabled: true, retentionDays: 7 },
    headers: { "content-type": type }, rawBody: Buffer.from(text), receivedBytes: Buffer.byteLength(text) };
}

test("configured/default keys are removed through objects and arrays, with safe siblings and visible counts", () => {
  const data = input('{"Password":"synthetic-private","nested":[{"TOKEN":{"anything":"synthetic-private"},"keep":true},[{"Custom.Key":"synthetic-private","safe":1}]],"keep":null}');
  const result = createCaptureSanitizer({ sensitiveJsonKeys: ["custom.key"] })(data);
  expect(result.body).toEqual({ format: "json", parseFailed: false, value: { nested: [{ keep: true }, [{ safe: 1 }]], keep: null } });
  expect(result.redaction).toEqual({ headerPolicy: "content-type-only", jsonKeysRemoved: 3, bodyOmitted: false });
  expect(JSON.stringify(result).includes("synthetic-private")).toBe(false);
  expect(data.rawBody.includes("synthetic-private")).toBe(true);
});

test("exact literal case-insensitive names do not act as paths, patterns or substring matching", () => {
  const result = createCaptureSanitizer({ sensitiveJsonKeys: ["a.b", "[*]", "__proto__"] })(input('{"a.b":1,"a":{"b":2},"[*]":3,"__proto__":{"bad":true},"constructor":{"prototype":{"token":4,"keep":5}},"token_hint":6,"passwordless":true,"t\\u006fken":7}'));
  expect(result.body).toEqual({ format: "json", parseFailed: false, value: { a: { b: 2 }, constructor: { prototype: { keep: 5 } }, token_hint: 6, passwordless: true } });
  expect(result.redaction.jsonKeysRemoved).toBe(5);
  expect(Object.hasOwn(Object.prototype, "bad")).toBe(false);
});

test("all JSON roots, escaped names, duplicate keys and reserved names stay inert and serializable", () => {
  for (const text of ['null', 'true', '12.5', '"synthetic"', '[]', '{}']) {
    expect(createCaptureSanitizer()(input(text)).body.value).toEqual(JSON.parse(text));
  }
  const result = createCaptureSanitizer()(input('{"password":1,"password":2,"__proto__":{"token":3,"ok":true},"script":"globalThis.syntheticSanitizerExecuted=true"}'));
  expect(JSON.parse(JSON.stringify(result.body.value))).toEqual(JSON.parse('{"__proto__":{"ok":true},"script":"globalThis.syntheticSanitizerExecuted=true"}'));
  expect(result.redaction.jsonKeysRemoved).toBe(2);
  expect(Object.hasOwn(globalThis, "syntheticSanitizerExecuted")).toBe(false);
});

test("header omission is a closed projection for every casing, arbitrary credentials and MIME parameters", () => {
  const data = input('{}', 'Application/JSON; private="synthetic-private"; charset=UTF-8');
  for (const name of ["authorization", "Authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "X-Api-Key", "x-custom-credential", "x-hub-signature-256", "host"]) {
    data.headers = { ...data.headers, [name]: "synthetic-private" };
  }
  const original = JSON.stringify(data.headers), bytes = Buffer.from(data.rawBody);
  const result = createCaptureSanitizer()(data);
  expect(result.metadata.safeHeaders).toEqual({ "content-type": "application/json" });
  expect(JSON.stringify(result).includes("synthetic-private")).toBe(false);
  expect(Object.hasOwn(result, "headers") || Object.hasOwn(result, "rawBody")).toBe(false);
  expect(JSON.stringify(data.headers) === original && data.rawBody.equals(bytes)).toBe(true);
});

test("configuration is bounded, snapshotted, additive to defaults and errors never echo key values", () => {
  const keys = ["custom"]; const options = { sensitiveJsonKeys: keys, captureBody: true };
  const sanitize = createCaptureSanitizer(options); keys[0] = "other"; options.captureBody = false;
  expect(sanitize(input('{"custom":1,"password":2,"other":3}')).body.value).toEqual({ other: 3 });
  for (const value of [null, true, 1, "synthetic-private", [], { captureBody: "yes" }, { sensitiveJsonKeys: "synthetic-private" },
    { sensitiveJsonKeys: null }, { sensitiveJsonKeys: Array(1) }, { sensitiveJsonKeys: [null] }, { sensitiveJsonKeys: [""] }, { sensitiveJsonKeys: ["\n"] },
    { sensitiveJsonKeys: ["synthetic-private".repeat(20)] }, { sensitiveJsonKeys: Array(MAX_CUSTOM_REDACTION_KEYS + 1).fill("x") }]) {
    expect(() => createCaptureSanitizer(value as never)).toThrow("Invalid capture redaction policy");
  }
  expect(() => createCaptureSanitizer({ sensitiveJsonKeys: Array(MAX_CUSTOM_REDACTION_KEYS).fill("x".repeat(MAX_REDACTION_KEY_LENGTH)) })).not.toThrow();
});

test("disabled body capture omits JSON/text/form/failures; GET/HEAD remain metadata with their byte count", () => {
  const sanitize = createCaptureSanitizer({ captureBody: false });
  for (const [text, type] of [['{"secret":"synthetic-private"}', "application/json"], ["synthetic-private", "text/html"], ["secret=synthetic-private", "application/x-www-form-urlencoded"], ['{"synthetic-private":', "application/json"]]) {
    const result = sanitize(input(text!, type));
    expect(result.body).toEqual({ format: "omitted", parseFailed: false, value: null });
    expect(result.redaction.bodyOmitted).toBe(true);
    expect(JSON.stringify(result).includes("synthetic-private")).toBe(false);
  }
  for (const method of ["GET", "HEAD"] as const) {
    const data = input(""); data.method = method; data.receivedBytes = 100;
    const result = sanitize(data);
    expect(result.body).toEqual({ format: "metadata", parseFailed: false, value: null });
    expect(result.metadata.receivedBytes).toBe(100); expect(result.redaction.bodyOmitted).toBe(false);
  }
});

test("parse failures have static flags/no raw fallback; non-JSON values are explicitly not key-redacted", () => {
  const sanitize = createCaptureSanitizer();
  for (const [text, type, reason] of [['{"secret":', "application/json", "invalid_json"], ["secret=%FF", "application/x-www-form-urlencoded", "invalid_form"]]) {
    expect(sanitize(input(text!, type)).body).toEqual({ format: "unparsed", parseFailed: true, value: null, reason });
  }
  expect(sanitize(input("secret=synthetic", "application/x-www-form-urlencoded")).body.value).toEqual([["secret", "synthetic"]]);
  expect(sanitize(input('secret=synthetic <script>inert</script>', "text/plain")).body.value).toBe('secret=synthetic <script>inert</script>');
});

test("maximum depth and byte bounds retain useful data while removing secrets, with isolation between captures", () => {
  const sanitize = createCaptureSanitizer();
  const nested = "[".repeat(MAX_JSON_DEPTH - 1) + '{"password":"synthetic-private","ok":1}' + "]".repeat(MAX_JSON_DEPTH - 1);
  const result = sanitize(input(nested));
  expect(result.body.parseFailed).toBe(false); expect(result.redaction.jsonKeysRemoved).toBe(1);
  expect(JSON.stringify(result).includes("synthetic-private")).toBe(false);
  const prefix = '{"password":"synthetic-private","data":"', suffix = '"}';
  const exact = prefix + "a".repeat(MAX_CAPTURE_BYTES - prefix.length - suffix.length) + suffix;
  expect(sanitize(input(exact)).redaction.jsonKeysRemoved).toBe(1);
  expect(() => sanitize(input(exact + " "))).toThrow();
  const next = sanitize(input('{"ok":true}')); expect(next.redaction.jsonKeysRemoved).toBe(0);
  expect(next.body.value).toEqual({ ok: true });
});

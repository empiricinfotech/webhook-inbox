import { Types } from "mongoose";
import { expect, test } from "vitest";
import { prepareCapture, MAX_FORM_FIELDS, MAX_JSON_DEPTH } from "../../apps/api/src/capture/prepare.js";
import { MAX_CAPTURE_BYTES } from "../../apps/api/src/capture/raw-body.js";
import type { RawCaptureInput } from "../../apps/api/src/routes/capture.js";
import { ApiError } from "../../apps/api/src/errors.js";

function input(text = "", type: string | undefined = "text/plain"): RawCaptureInput {
  return { method: "POST", receivedAt: new Date("2026-11-04T09:00:00.000Z"),
    inbox: { inboxId: new Types.ObjectId(), workspaceId: new Types.ObjectId(), enabled: true, retentionDays: 7 },
    rawBody: Buffer.from(text), receivedBytes: Buffer.byteLength(text), headers: type === undefined ? {} : { "content-type": type } };
}
function failure(data: RawCaptureInput, reason: string) {
  const result = prepareCapture(data);
  expect(result.body).toEqual({ format: "unparsed", parseFailed: true, value: null, reason });
  return result;
}

test("metadata is generated from trusted arrival/method/count and a closed normalized header projection", () => {
  const data = input('{"synthetic":true}', ' Application/Problem+JSON ; Charset="UTF-8"; private="synthetic-private-param"');
  data.headers = { ...data.headers, authorization: "synthetic-private-auth", cookie: "synthetic-private-cookie",
    "x-api-key": "synthetic-private-key", "x-forwarded-for": "synthetic-private-ip", date: "synthetic-private-time" };
  const raw = Buffer.from(data.rawBody), headers = JSON.stringify(data.headers);
  const result = prepareCapture(data);
  expect(result.metadata).toEqual({ method: "POST", receivedAt: data.receivedAt.toISOString(), receivedBytes: data.receivedBytes,
    contentType: "application/problem+json", safeHeaders: { "content-type": "application/problem+json" } });
  expect(JSON.stringify(result.metadata).includes("synthetic-private")).toBe(false);
  expect(result.body).toEqual({ format: "json", parseFailed: false, value: { synthetic: true } });
  expect(data.rawBody.equals(raw)).toBe(true); expect(JSON.stringify(data.headers) === headers).toBe(true);
  expect(Object.hasOwn(result, "rawBody")).toBe(false); expect(Object.hasOwn(result, "headers")).toBe(false);
});

test("JSON supports nested values, all roots, UTF-8, BOM and literal prototype keys without executing or merging", () => {
  for (const text of ['null', 'true', '12.5', '"synthetic"', '[1,{"emoji":"😀"}]', '\uFEFF{"ok":true}']) {
    const expected = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
    expect(prepareCapture(input(text, "application/json")).body).toEqual({ format: "json", parseFailed: false, value: expected });
  }
  const data = input('{"__proto__":{"syntheticPollution":true},"constructor":{"prototype":{"syntheticPollution":true}},"script":"globalThis.syntheticCaptureExecuted=true"}', "application/json");
  const result = prepareCapture(data);
  expect(result.body.format).toBe("json");
  if (result.body.format !== "json") throw new Error("Expected parsed JSON");
  expect(Object.hasOwn(result.body.value as object, "__proto__")).toBe(true);
  expect(Object.hasOwn(Object.prototype, "syntheticPollution")).toBe(false);
  expect(Object.hasOwn(globalThis, "syntheticCaptureExecuted")).toBe(false);
});

test("invalid/empty/executable JSON and non-finite numbers return static flags without retaining partial content", () => {
  for (const text of ['', '{"synthetic-private":', '{"a":1,}', '(()=>{globalThis.syntheticCaptureExecuted=true})()', '{"n":1e400}']) {
    const result = failure(input(text, "application/json"), "invalid_json");
    expect(JSON.stringify(result).includes("synthetic-private")).toBe(false);
  }
  expect(Object.hasOwn(globalThis, "syntheticCaptureExecuted")).toBe(false);
});

test("JSON depth is bounded iteratively at exactly 64 containers", () => {
  const nested = (depth: number) => "[".repeat(depth) + "0" + "]".repeat(depth);
  expect(prepareCapture(input(nested(MAX_JSON_DEPTH), "application/json")).body.parseFailed).toBe(false);
  failure(input(nested(MAX_JSON_DEPTH + 1), "application/json"), "json_depth");
});

test("URL-encoded form decoding preserves order, repeats, empty fields, Unicode and literal bracket/prototype names", () => {
  const data = input("a=1&a=2&empty=&flag&&=value&plus=a+b&equals=x=y&emoji=%F0%9F%98%80&obj%5Bx%5D=z&__proto__=synthetic", "application/x-www-form-urlencoded; charset=utf-8");
  expect(prepareCapture(data).body).toEqual({ format: "form", parseFailed: false,
    value: [["a", "1"], ["a", "2"], ["empty", ""], ["flag", ""], ["", "value"], ["plus", "a b"], ["equals", "x=y"], ["emoji", "😀"], ["obj[x]", "z"], ["__proto__", "synthetic"]] });
  expect(prepareCapture(input("", "application/x-www-form-urlencoded")).body).toEqual({ format: "form", parseFailed: false, value: [] });
  expect(Object.hasOwn(Object.prototype, "syntheticPollution")).toBe(false);
});

test("form invalid escapes/UTF-8 and excessive fields never yield a partial result", () => {
  for (const text of ['ok=1&bad=%', 'bad=%GG', 'bad=%FF', 'bad=%ED%A0%80']) failure(input(text, "application/x-www-form-urlencoded"), "invalid_form");
  const fields = Array(MAX_FORM_FIELDS).fill("a=1").join("&");
  const body = prepareCapture(input(fields, "application/x-www-form-urlencoded")).body;
  expect(body.format === "form" && body.value.length === MAX_FORM_FIELDS).toBe(true);
  failure(input(fields + "&b=2", "application/x-www-form-urlencoded"), "form_fields");
});

test("text remains inert exact Unicode data including HTML, JavaScript, newlines and a BOM", () => {
  for (const type of ["text/plain", "text/html", "text/javascript", "text/csv"]) {
    const text = "\uFEFF<script>globalThis.syntheticCaptureExecuted=true</script>\r\n😀 & + %20";
    expect(prepareCapture(input(text, type)).body).toEqual({ format: "text", parseFailed: false, value: text });
  }
  expect(prepareCapture(input("")).body).toEqual({ format: "text", parseFailed: false, value: "" });
  expect(Object.hasOwn(globalThis, "syntheticCaptureExecuted")).toBe(false);
});

test("missing/malformed/unselected media, charset, encoding and broken UTF-8 are explicit unparsed results", () => {
  const missing = input("synthetic"); missing.headers = {}; failure(missing, "missing_content_type");
  for (const type of ["not-a-type", "text/" + "a".repeat(513)]) failure(input("synthetic", type), "invalid_content_type");
  failure(input("synthetic", "application/octet-stream"), "unsupported_media");
  failure(input("synthetic", "text/plain; charset=iso-8859-1"), "unsupported_charset");
  const encoded = input("synthetic"); encoded.headers = { ...encoded.headers, "content-encoding": "gzip" }; failure(encoded, "encoded_body");
  for (const type of ["text/plain", "application/json", "application/x-www-form-urlencoded"]) {
    const data = input("", type); data.rawBody = Buffer.from([255]); data.receivedBytes = 1; failure(data, "invalid_utf8");
  }
});

test("GET/HEAD stay metadata-only, including bodies already counted/discarded by the collector", () => {
  for (const method of ["GET", "HEAD"] as const) {
    const data = input("", "application/json"); data.method = method; data.receivedBytes = 123;
    expect(prepareCapture(data).body).toEqual({ format: "metadata", parseFailed: false, value: null });
  }
});

test("preparation validates the collector/date contract and still accepts the exact body byte limit", () => {
  const exact = input("a".repeat(MAX_CAPTURE_BYTES)); expect(prepareCapture(exact).body.parseFailed).toBe(false);
  for (const kind of ["count", "overflow", "date"]) {
    const data = input("synthetic");
    if (kind === "count") data.receivedBytes--;
    if (kind === "overflow") data.receivedBytes = MAX_CAPTURE_BYTES + 1;
    if (kind === "date") data.receivedAt = new Date(Number.NaN);
    try { prepareCapture(data); throw new Error("Expected rejection"); }
    catch (error) { expect(error instanceof ApiError && error.code === "INVALID_REQUEST").toBe(true); expect(Object.hasOwn(error as object, "cause")).toBe(false); }
  }
});

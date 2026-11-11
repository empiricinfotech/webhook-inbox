# Capture redaction policy

D07.1 | 11 November 2026

The Express backend provides `createCaptureSanitizer` in
`apps/api/src/capture/sanitize.ts`. It composes existing bounded private preparation
with credential-header omission and configured recursive JSON-key removal. Its
output contains inbox identifiers, projected metadata, body and redaction flags.
It contains no original headers, URL/query or raw buffer. It remains private
workspace data; the type name does not guarantee that every secret was discovered.

## Configure and exercise

Use the pinned toolchain and an owned native MongoDB 8 fixture:

```bash
npm test -- tests/unit/capture-sanitize.test.ts tests/api/capture-transport.test.ts
```

Trusted server code compiles a policy for an inbox, then uses the returned function
on the existing RawCaptureInput. This is an internal configuration interface, not
a new public endpoint, database setting or UI. Inbound headers/query/body cannot
select or weaken the policy. A later capture composition must select the trusted
policy for the resolved inbox before any persistence. For example:

```ts
const sanitize = createCaptureSanitizer({
  sensitiveJsonKeys: ["customer_secret", "private_value"],
  captureBody: true,
});
const sanitized = sanitize(raw); // private input from the optional capture router
// D07.2 must durably persist only sanitized data before acknowledging capture.
```

For synthetic JSON
`{"password":"synthetic-secret","nested":[{"private_value":1,"keep":true}]}`,
this policy produces `{"nested":[{"keep":true}]}` and reports two removed keys.
Examples/tests use synthetic data. Ordinary API/local-dashboard startup remains
unchanged: it does not mount a product capture receiver. HTTP tests observe results
in memory and return 204 only; they store no event and return no event ID.

## Header omission

The closed projection retains only the normalized Content-Type essence from
preparation. All credential headers are omitted entirely, regardless of their
name or casing: Authorization, Proxy-Authorization, Cookie, Set-Cookie, API keys,
custom credentials and original provider signatures. Arbitrary/provider headers,
Host, forwarded addresses, inbound IDs and MIME parameters are also excluded.
This deliberately sacrifices some debugging metadata rather than maintaining an
incomplete credential denylist. `redaction.headerPolicy` is always
`content-type-only`; it describes the applied rule, not a count of input headers.
Raw headers/bytes remain ephemeral for later signature verification. They must
never be logged, queued, exported or persisted.

## Recursive JSON rules

The default names are: authorization, cookie, password, passwd, secret, token,
access_token, refresh_token, api_key, apikey, client_secret and clientsecret.
Configured names extend these defaults; an empty list cannot disable them.
Comparison lowercases both names with JavaScript toLowerCase, then compares exact
strings. No trimming, Unicode normalization, regex, glob, dot path or substring
matching is performed. Configure literal field names explicitly, including
provider-specific aliases. A key named `a.b` is a literal key, not a path.
Escaped JSON property names are decoded by the parser before comparison.

Matching object properties are removed with their entire subtree. Arrays keep
order and length; objects inside arrays are visited recursively. Primitive roots
and unmatched values remain unchanged. `redaction.jsonKeysRemoved` counts matched
properties removed, not descendants inside an already removed subtree, secret
occurrences or a completeness score. Duplicate keys follow the existing parser's
last-value semantics. Null-prototype result objects preserve literal __proto__/
constructor/prototype names without merging/executing them and serialize as JSON.
No raw input or private prepared value is mutated; each invocation has its own
result/count. Original bytes therefore remain available for later HMAC checks.

Policy compilation accepts at most 64 custom names, each 1–128 UTF-16 code units,
without C0/DEL control characters. Invalid types/null/sparse entries or invalid
bounds throw only `Invalid capture redaction policy`, without echoing values.
The names and captureBody boolean are snapshotted when compiled. The existing
256 KiB byte limit and 64-container parser depth bound the transformation. No
new dependency, arbitrary callback or unbounded user-configured transform is used.

## Bodies, flags and limits

With `captureBody: false`, every non-metadata body becomes
`{format:"omitted",parseFailed:false,value:null}` and `bodyOmitted:true`. This
explicit policy result replaces even a failed parse; its false flag does not
assert that omitted input was valid JSON. GET/HEAD remain metadata-only with the
actual received-byte count and `bodyOmitted:false`. Transport limits/media checks
still apply. Existing parse failures with capture enabled retain static reason
flags and null values, without a partial/raw fallback. No content is truncated.

JSON key removal does not scan string contents, property names that were not
configured, base64/encoded values, arbitrary aliases or secrets embedded inside
otherwise safe values. Text (including HTML/JavaScript) and decoded ordered form
pairs remain inert, exact data when body capture is enabled; **they are not
key-redacted or guaranteed secret-free**. Use synthetic data and disable body
capture where appropriate. Safe display rendering remains D09 work.

## Verification and next task

Eight unit checks cover nested/array/default/configured matching, exact/escaped/
reserved names, primitive roots, duplicate keys, credential casing, immutable
input, bounded/snapshotted policy, omission, static failures, non-JSON limits,
maximum byte/depth boundaries and independent captures. Three real HTTP/Mongo
checks compose the existing token eligibility/transport with the sanitizer and
verify private logs/errors, per-policy isolation, GET/HEAD/OPTIONS and recovery.
No event is inserted. Normal test discovery and Foundation CI include the checks.

D07.2 is next: event persistence, expiry/parse/redaction flags and acknowledgement
only after successful storage. D07.3 database-failure/stored-fixture checks,
D09 safe rendering, D20 signatures and all release gates remain pending. The
Day 07 stored-secret/outage acceptance is not claimed by this individual task.

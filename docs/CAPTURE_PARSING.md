# Capture metadata and private payload preparation

D06.2 | 4 November 2026

The Express API now provides prepareCapture in apps/api/src/capture/prepare.ts.
It consumes the validated [raw transport input](CAPTURE_TRANSPORT.md), creates a
small metadata projection and parses JSON, URL-encoded form or text as inert data.
It is an internal, synchronous preparation step, not an event model or public DTO.
Normal API/local-dashboard startup still does not mount product capture.

## Exercise and compose

Use the [pinned toolchain](TOOLCHAIN.md) and a native MongoDB 8 binary:

```bash
npm run bootstrap
npm test -- tests/unit/capture-prepare.test.ts tests/api/capture-transport.test.ts
```

These tests own disposable loopback HTTP/Mongo resources and use synthetic data.
The composed test handler calls prepareCapture(raw), observes the result in
memory and ends with 204. This probe creates no event or capture acknowledgement.
The existing optional router still requires an explicit downstream handler.
The D07.1 [sanitizer](CAPTURE_REDACTION.md) now calls prepareCapture(raw) internally;
configured signature verification must inspect raw.rawBody first. Keep raw
input ephemeral, and never log, queue, export or persist it.

PreparedCapture contains internal inbox identifiers, metadata and body. It omits
rawBody and the original header map. It is still private: successfully parsed
JSON/form/text may contain secrets and is NOT safe to persist or expose. D07.1
provides a separate sanitizer; D07.2 must durably store its output before returning
201/captured:true.
No default handler, raw vault, forwarding, event store or success response is added.

## Metadata contract

- method is the existing explicit transport method.
- receivedAt is an ISO UTC timestamp taken by Express when its capture route is
  entered, before token lookup/body collection. Inbound Date/forwarded time fields
  do not control it. OPTIONS/denied methods do not invoke preparation.
- receivedBytes is the collector's actual byte count, bounded at 262144. GET/HEAD
  retain this count while supplying no body. A mismatched collector count, invalid
  trusted timestamp or out-of-bound direct call throws static INVALID_REQUEST.
- contentType is Node MIMEType's lowercased type/subtype essence, or null if absent/
  invalid. The original Content-Type field is bounded at 512 characters before
  parsing. Quoted parameters use Node's MIME parser; no custom MIME grammar is added.
- safeHeaders is a conservative closed projection containing only the normalized
  content-type essence when available. Parameters, arbitrary/provider headers,
  credential headers, Host, forwarding fields and client dates are not copied.
  No URL, query, capture token, IP or inbound request ID is added. This minimal
  metadata projection does not complete D07.1's wider redaction/storage policy.

Metadata is private operational evidence, not a claim that arbitrary user-supplied
media names cannot contain private text. Do not treat a field named safeHeaders
as permission to log a full PreparedCapture or expose it without workspace access.
The existing request logger and static correlated error envelope remain unchanged.

## Body contract and decisions

Every result has format, parseFailed and value. GET/HEAD return metadata/false/null
without parsing discarded bytes, even when the advertised body type is JSON.
Other methods use the following choices:

| Input | Result |
|---|---|
| application/json or application subtype ending +json | json with a JSON value, including primitive/null roots |
| application/x-www-form-urlencoded | form with ordered string pairs; repeated names and order survive |
| text/*, including HTML/JavaScript | text with the exact decoded string; no evaluation or rendering |
| Unselected or malformed input | unparsed/true/null plus a static reason; no partial body or exception text |

Only UTF-8 (absent charset, utf-8 or utf8) is decoded. TextDecoder uses fatal
errors and preserves a leading BOM for text/form. JSON alone tolerates one leading
BOM without modifying raw bytes. No decoding replacement or compression inflation
is performed. Non-identity Content-Encoding is left unparsed.

JSON uses JSON.parse without a reviver or executable callbacks. Own __proto__/
constructor keys remain data and are never merged into application objects.
An iterative walk caps container nesting at 64; non-finite numbers are flagged.
Normal JavaScript number precision and last-value behavior for duplicate object
keys apply; encode precision-sensitive provider IDs as strings. Empty/malformed
JSON is flagged rather than mislabeled as text or retained as a raw fallback.

Form parsing splits on &, the first = and +, then applies strict UTF-8 percent
decoding. Empty segments are skipped; a name without = has an empty value. Names
with brackets/prototype keys remain literal strings, never nested object paths.
Malformed escapes/percent-encoded UTF-8 yield invalid_form instead of partial or
replacement data. This deliberately stricter choice differs from forgiving web
URL decoding. The limit is 1000 nonempty field segments with no silent truncation.
Depth, field and header limits are initial defensive decisions, not load results.

Static failure reasons: missing_content_type, invalid_content_type,
unsupported_media, unsupported_charset, encoded_body, invalid_utf8, invalid_json,
json_depth, invalid_form and form_fields. The raw collector input remains unchanged
and separate; no partial parsed value is delivered when parseFailed is true.

## Remaining boundaries

An unparsed result is NOT a storage decision. D06.3 now enforces [HTTP media
rejection](CAPTURE_MEDIA.md) in the optional raw router before downstream delivery.
Unsupported headers or nontext wire bytes yield 415; overflow yields 413. Direct
internal preparation calls still report static flags, while malformed JSON/form
syntax in otherwise valid wire text continues to produce parse-failure flags.

D07.1 redaction is implemented separately. D07.2 storage, D09 rendering, D20
signatures, browser journeys, provider capture-to-store examples and all release gates remain pending. Plain text can
contain sensitive information; no universal body-safety guarantee is made.

## Verification and references

Ten unit checks cover metadata privacy, UTF-8/BOM, nested/primitive/literal-key
JSON, static failures, exact depth/form/byte bounds, inert HTML/JavaScript, repeated
form fields and the trusted input contract. Four additional real-Mongo/HTTP checks
compose the parser with real token eligibility/transport, check GET/HEAD/OPTIONS,
malformed inputs/recovery, timestamps, private logs and zero persisted events.
Normal test/CI discovers these without dependencies or a separate runner.
Browser interaction is not applicable to this backend-only task.

Primary references: [RFC 8259 encoding and parsers](https://www.rfc-editor.org/rfc/rfc8259.html#section-8),
[WHATWG TextDecoder](https://encoding.spec.whatwg.org/#interface-textdecoder) and
[form parsing](https://url.spec.whatwg.org/#urlencoded-parsing).
Node MIMEType/TextDecoder public APIs and behavior were also checked against the
installed Node 24 declarations and the actual pinned Node 24.22.0 runtime.

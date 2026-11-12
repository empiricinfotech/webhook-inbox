import { z } from "zod";
import { MAX_CUSTOM_REDACTION_KEYS, MAX_REDACTION_KEY_LENGTH } from "../capture/sanitize.js";
import { parseEnvironment } from "@empiric-webhook-inbox/contracts/environment";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";

export function readWebOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new EnvironmentConfigurationError(["LOCAL_WEB_ORIGIN"]); }
}


// Explicit server-local policy; configuration errors report field names only.
export function readLocalCapturePolicy(source: Record<string, string | undefined> = process.env) {
  const key = z.string().min(1).max(MAX_REDACTION_KEY_LENGTH).refine(value =>
    [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
  const parsed = parseEnvironment(z.object({
    LOCAL_CAPTURE_BODY: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
    LOCAL_SENSITIVE_JSON_KEYS: z.string().max(65_536).default("[]").transform((value, context) => {
      try { return JSON.parse(value) as unknown; }
      catch { context.addIssue({ code: "custom", message: "Invalid JSON" }); return z.NEVER; }
    }).pipe(z.array(key).max(MAX_CUSTOM_REDACTION_KEYS)),
  }), { LOCAL_CAPTURE_BODY: source.LOCAL_CAPTURE_BODY, LOCAL_SENSITIVE_JSON_KEYS: source.LOCAL_SENSITIVE_JSON_KEYS });
  return { captureBody: parsed.LOCAL_CAPTURE_BODY, sensitiveJsonKeys: parsed.LOCAL_SENSITIVE_JSON_KEYS };
}

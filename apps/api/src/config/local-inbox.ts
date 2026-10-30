import { z } from "zod";
import { parseEnvironment } from "@empiric-webhook-inbox/contracts/environment";
import { identifierSchema } from "@empiric-webhook-inbox/contracts/identifiers";
import { inboxNameSchema } from "@empiric-webhook-inbox/contracts/inboxes";
import { KEY_VERSION_PATTERN } from "../security/capture-token.js";

function isLocalDatabase(value: string): boolean {
  try {
    const uri = new URL(value);
    // No SRV, multiple hosts or replica discovery that could escape this local command.
    return uri.protocol === "mongodb:" && ["127.0.0.1", "[::1]"].includes(uri.hostname)
      && /^\/[A-Za-z0-9_-]{1,63}$/.test(uri.pathname)
      && !["/admin", "/config", "/local"].includes(uri.pathname.toLowerCase())
      && [...uri.searchParams.keys()].every((key) => key === "directConnection")
      && uri.searchParams.getAll("directConnection").every((item) => item === "true") && !uri.hash;
  } catch { return false; }
}
export const localInboxEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]).default("development"),
  MONGODB_URI: z.string().max(4096).refine(isLocalDatabase).transform((value) => {
    const uri = new URL(value);
    uri.searchParams.set("directConnection", "true");
    return uri.toString();
  }),
  LOCAL_OWNER_ID: identifierSchema,
  LOCAL_WORKSPACE_ID: identifierSchema,
  LOCAL_WORKSPACE_NAME: inboxNameSchema,
  CAPTURE_TOKEN_KEY_VERSION: z.string().regex(KEY_VERSION_PATTERN),
  CAPTURE_TOKEN_KEY_HEX: z.string().regex(/^[0-9a-f]{64}$/),
});
export function readLocalInboxEnvironment(source: Record<string, string | undefined> = process.env) {
  return parseEnvironment(localInboxEnvironmentSchema, {
    NODE_ENV: source.NODE_ENV, MONGODB_URI: source.MONGODB_URI,
    LOCAL_OWNER_ID: source.LOCAL_OWNER_ID, LOCAL_WORKSPACE_ID: source.LOCAL_WORKSPACE_ID,
    LOCAL_WORKSPACE_NAME: source.LOCAL_WORKSPACE_NAME,
    CAPTURE_TOKEN_KEY_VERSION: source.CAPTURE_TOKEN_KEY_VERSION, CAPTURE_TOKEN_KEY_HEX: source.CAPTURE_TOKEN_KEY_HEX,
  });
}

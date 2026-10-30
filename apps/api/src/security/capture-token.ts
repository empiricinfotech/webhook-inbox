import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const TOKEN_BYTES = 32;
export const KEY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
export const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const identifier = z.string().regex(/^[0-9a-f]{24}$/);
const contextSchema = z.strictObject({ workspaceId: identifier, inboxId: identifier });
export type CaptureTokenContext = z.output<typeof contextSchema>;
export const encryptedCaptureTokenSchema = z.strictObject({
  formatVersion: z.literal(1),
  keyVersion: z.string().regex(KEY_VERSION_PATTERN),
  nonce: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z.string().regex(/^[0-9a-f]{86}$/),
  tag: z.string().regex(/^[0-9a-f]{32}$/),
});
export type EncryptedCaptureToken = z.output<typeof encryptedCaptureTokenSchema>;
export interface CaptureTokenKeys {
  currentVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
}

// Never attach input, key material or a crypto/driver cause to this error.
export class CaptureTokenError extends Error {
  constructor() { super("Capture token operation failed"); this.name = "CaptureTokenError"; }
}

export function hashCaptureToken(token: unknown): string | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== TOKEN_BYTES || bytes.toString("base64url") !== token) return null;
  return createHash("sha256").update(token, "ascii").digest("hex");
}

function associatedData(context: CaptureTokenContext, keyVersion: string): Buffer {
  const parsed = contextSchema.safeParse(context);
  if (!parsed.success) throw new CaptureTokenError();
  return Buffer.from(JSON.stringify(["webhook-capture-token", 1, keyVersion,
    parsed.data.workspaceId, parsed.data.inboxId]), "utf8");
}

export function createCaptureTokenCrypto(configuration: CaptureTokenKeys) {
  // Copy bytes into KeyObjects; subsequent caller mutations cannot change keys.
  if (!configuration || typeof configuration.currentVersion !== "string" || !KEY_VERSION_PATTERN.test(configuration.currentVersion)
    || !(configuration.keys instanceof Map) || !configuration.keys.has(configuration.currentVersion)) {
    throw new CaptureTokenError();
  }
  const keys = new Map<string, ReturnType<typeof createSecretKey>>();
  for (const [version, material] of configuration.keys) {
    if (typeof version !== "string" || !KEY_VERSION_PATTERN.test(version) || !(material instanceof Uint8Array) || material.byteLength !== 32) {
      throw new CaptureTokenError();
    }
    keys.set(version, createSecretKey(Buffer.from(material)));
  }
  const currentVersion = configuration.currentVersion;
  return Object.freeze({
    issue(context: CaptureTokenContext) {
      try {
        const aad = associatedData(context, currentVersion);
        const token = randomBytes(TOKEN_BYTES).toString("base64url");
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", keys.get(currentVersion)!, nonce, { authTagLength: 16 });
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(token, "ascii"), cipher.final()]);
        const encryptedToken: EncryptedCaptureToken = {
          formatVersion: 1, keyVersion: currentVersion, nonce: nonce.toString("hex"),
          ciphertext: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex"),
        };
        // Only the owner-retrieval method releases plaintext; issuance returns storage fields.
        return { tokenHash: hashCaptureToken(token)!, encryptedToken };
      } catch { throw new CaptureTokenError(); }
    },
    decrypt(envelope: unknown, context: CaptureTokenContext, expectedHash: unknown): string {
      try {
        const parsed = encryptedCaptureTokenSchema.safeParse(envelope);
        if (!parsed.success || typeof expectedHash !== "string" || !TOKEN_HASH_PATTERN.test(expectedHash)) {
          throw new CaptureTokenError();
        }
        const value = parsed.data;
        const key = keys.get(value.keyVersion);
        if (!key) throw new CaptureTokenError();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.nonce, "hex"), { authTagLength: 16 });
        decipher.setAAD(associatedData(context, value.keyVersion));
        decipher.setAuthTag(Buffer.from(value.tag, "hex"));
        // Do not use partial plaintext before authentication succeeds at final().
        const token = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "hex")), decipher.final()]).toString("utf8");
        const actualHash = hashCaptureToken(token);
        if (!actualHash || !timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"))) {
          throw new CaptureTokenError();
        }
        return token;
      } catch { throw new CaptureTokenError(); }
    },
  });
}
export type CaptureTokenCrypto = ReturnType<typeof createCaptureTokenCrypto>;

import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { createCaptureTokenCrypto, CaptureTokenError, hashCaptureToken } from "../../apps/api/src/security/capture-token.js";
import { getInboxModel } from "../../apps/api/src/models/inbox.js";

const context = { workspaceId: new Types.ObjectId().toHexString(), inboxId: new Types.ObjectId().toHexString() };
const key = randomBytes(32);
const crypto = createCaptureTokenCrypto({ currentVersion: "key-1", keys: new Map([["key-1", key]]) });

function rejectsSafely(operation: () => unknown) {
  try { operation(); throw new Error("Expected capture token failure"); }
  catch (error) {
    expect(error instanceof CaptureTokenError).toBe(true);
    expect((error as Error).message === "Capture token operation failed").toBe(true);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
  }
}

test("tokens use canonical 32-byte encoding and indexed SHA-256 hashes", () => {
  const hashes = new Set<string>();
  for (let index = 0; index < 100; index++) {
    const credential = crypto.issue(context);
    const token = crypto.decrypt(credential.encryptedToken, context, credential.tokenHash);
    expect(token.length).toBe(43);
    expect(Buffer.from(token, "base64url").length).toBe(32);
    expect(hashCaptureToken(token) === credential.tokenHash).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(credential.tokenHash)).toBe(true);
    hashes.add(credential.tokenHash);
  }
  expect(hashes.size).toBe(100);
});

test("lookup validation rejects malformed and noncanonical bearer input", () => {
  for (const token of [undefined, null, 1, {}, { $ne: null }, [], "", "x".repeat(42),
    "x".repeat(44), "a".repeat(42) + "B", "!".repeat(43), "é".repeat(43), randomBytes(32).toString("base64url") + "\n"]) {
    expect(hashCaptureToken(token) === null).toBe(true);
  }
});

test("fresh nonces and context binding reject altered or substituted envelopes", () => {
  const credential = crypto.issue(context);
  const next = crypto.issue(context);
  expect(credential.encryptedToken.nonce !== next.encryptedToken.nonce).toBe(true);
  const change = (text: string) => (text[0] === "0" ? "1" : "0") + text.slice(1);
  for (const envelope of [null, {}, { ...credential.encryptedToken, extra: true },
    { ...credential.encryptedToken, formatVersion: 2 }, { ...credential.encryptedToken, keyVersion: "unknown" },
    { ...credential.encryptedToken, nonce: change(credential.encryptedToken.nonce) },
    { ...credential.encryptedToken, ciphertext: change(credential.encryptedToken.ciphertext) },
    { ...credential.encryptedToken, tag: change(credential.encryptedToken.tag) }]) {
    rejectsSafely(() => crypto.decrypt(envelope, context, credential.tokenHash));
  }
  for (const changedContext of [
    { ...context, workspaceId: new Types.ObjectId().toHexString() },
    { ...context, inboxId: new Types.ObjectId().toHexString() },
  ]) rejectsSafely(() => crypto.decrypt(credential.encryptedToken, changedContext, credential.tokenHash));
  const aliases = createCaptureTokenCrypto({ currentVersion: "key-1", keys: new Map([["key-1", key], ["alias", key]]) });
  rejectsSafely(() => aliases.decrypt({ ...credential.encryptedToken, keyVersion: "alias" }, context, credential.tokenHash));
  rejectsSafely(() => crypto.decrypt(credential.encryptedToken, context, "0".repeat(64)));
  rejectsSafely(() => crypto.issue({ ...context, inboxId: "invalid" }));
  rejectsSafely(() => crypto.issue({ ...context, inboxId: context.inboxId + "\n" }));
  rejectsSafely(() => crypto.decrypt(credential.encryptedToken, context, credential.tokenHash + "\n"));
  for (const field of ["keyVersion", "nonce", "ciphertext", "tag"] as const) {
    rejectsSafely(() => crypto.decrypt({ ...credential.encryptedToken,
      [field]: credential.encryptedToken[field] + "\n" }, context, credential.tokenHash));
  }
});

test("versioned operator keys support old decryption and fail closed for missing or wrong keys", () => {
  const credential = crypto.issue(context);
  const secondKey = randomBytes(32);
  const updated = createCaptureTokenCrypto({ currentVersion: "key-2", keys: new Map([["key-1", key], ["key-2", secondKey]]) });
  expect(updated.decrypt(credential.encryptedToken, context, credential.tokenHash)
    === crypto.decrypt(credential.encryptedToken, context, credential.tokenHash)).toBe(true);
  expect(updated.issue(context).encryptedToken.keyVersion).toBe("key-2");
  for (const keys of [new Map([["key-2", secondKey]]), new Map([["key-1", secondKey], ["key-2", secondKey]])]) {
    const unavailable = createCaptureTokenCrypto({ currentVersion: "key-2", keys });
    rejectsSafely(() => unavailable.decrypt(credential.encryptedToken, context, credential.tokenHash));
  }
});

test("bad key configuration fails safely and imported key bytes are copied", () => {
  for (const settings of [
    { currentVersion: "", keys: new Map([["", key]]) },
    { currentVersion: "key-1\n", keys: new Map([["key-1\n", key]]) },
    { currentVersion: "key-1", keys: new Map<string, Uint8Array>() },
    { currentVersion: "key-1", keys: new Map([["key-1", randomBytes(31)]]) },
    { currentVersion: "key-1", keys: new Map([["key-1", randomBytes(33)]]) },
    { currentVersion: "key-1", keys: new Map([["key-1", key], ["bad version", key]]) },
  ]) rejectsSafely(() => createCaptureTokenCrypto(settings));
  const material = randomBytes(32);
  const copied = createCaptureTokenCrypto({ currentVersion: "copy", keys: new Map([["copy", material]]) });
  const credential = copied.issue(context);
  material.fill(0);
  expect(hashCaptureToken(copied.decrypt(credential.encryptedToken, context, credential.tokenHash)) === credential.tokenHash).toBe(true);
});

test("schema credentials are paired, strictly shaped and omitted from fresh-document serialization", async () => {
  const connection = mongoose.createConnection();
  try {
    const Inbox = getInboxModel(connection);
    const base = { workspaceId: new Types.ObjectId(context.workspaceId), name: "Synthetic inbox" };
    const credential = crypto.issue(context);
    const valid = new Inbox({ ...base, ...credential });
    await valid.validate();
    for (const value of [valid.toJSON(), valid.toObject()]) {
      expect(Object.hasOwn(value, "tokenHash")).toBe(false);
      expect(Object.hasOwn(value, "encryptedToken")).toBe(false);
    }
    for (const fields of [{ tokenHash: credential.tokenHash }, { encryptedToken: credential.encryptedToken },
      { tokenHash: null, encryptedToken: null },
      { ...credential, tokenHash: "invalid" },
      { ...credential, encryptedToken: { ...credential.encryptedToken, tag: "invalid" } },
      { ...credential, tokenHash: credential.tokenHash + "\n" },
      ...(["keyVersion", "nonce", "ciphertext", "tag"] as const).map((field) => ({
        ...credential, encryptedToken: { ...credential.encryptedToken,
          [field]: credential.encryptedToken[field] + "\n" },
      }))]) {
      await expect(new Inbox({ ...base, ...fields }).validate()).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
    }
  } finally { await connection.close(); }
});

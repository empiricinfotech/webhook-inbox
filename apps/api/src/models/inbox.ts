import { Schema, type Connection, type InferSchemaType } from "mongoose";
import { KEY_VERSION_PATTERN, TOKEN_HASH_PATTERN } from "../security/capture-token.js";

export const INBOX_NAME_MAX_LENGTH = 100;
export const INBOX_DESCRIPTION_MAX_LENGTH = 500;
export const RETENTION_DAYS = [1, 7, 30] as const;
export const DEFAULT_RETENTION_DAYS = 7;

const encryptedTokenSchema = new Schema({
  formatVersion: { type: Number, required: true, cast: false, enum: [1] },
  keyVersion: { type: String, required: true, cast: false, match: KEY_VERSION_PATTERN },
  nonce: { type: String, required: true, cast: false, match: /^[0-9a-f]{24}$/ },
  ciphertext: { type: String, required: true, cast: false, match: /^[0-9a-f]{86}$/ },
  tag: { type: String, required: true, cast: false, match: /^[0-9a-f]{32}$/ },
}, { _id: false, strict: "throw" });

export const inboxSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, required: true, cast: false, immutable: true },
  name: {
    type: String, required: true, cast: false, trim: true,
    minlength: 1, maxlength: INBOX_NAME_MAX_LENGTH,
    validate: {
      validator: (value: string) => [...value].every((character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
      message: "Inbox name must not contain control characters" },
  },
  description: {
    type: String, cast: false, trim: true, maxlength: INBOX_DESCRIPTION_MAX_LENGTH, default: "",
    validate: {
      validator: (value: unknown) => typeof value === "string" && [...value].every((character) => {
        const code = character.charCodeAt(0);
        return (code >= 32 || code === 9 || code === 10 || code === 13) && code !== 127;
      }),
      message: "Inbox description must be text without unsafe control characters" },
  },
  enabled: { type: Boolean, required: true, cast: false, default: true },
  retentionDays: { type: Number, required: true, cast: false, enum: RETENTION_DAYS, default: DEFAULT_RETENTION_DAYS },
  tokenHash: { type: String, cast: false, match: TOKEN_HASH_PATTERN, select: false },
  encryptedToken: { type: encryptedTokenSchema, select: false },
}, {
  collection: "inboxes", timestamps: true, strict: "throw", strictQuery: "throw",
  bufferCommands: false, autoCreate: false, autoIndex: false,
});
inboxSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
// Metadata-only records remain valid until bootstrap/creation is implemented.
inboxSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } });
inboxSchema.pre("validate", function () {
  const hash = this.tokenHash;
  const envelope = this.encryptedToken;
  if (hash === null || envelope === null || (hash === undefined) !== (envelope === undefined)) {
    this.invalidate("tokenHash", "Capture credential fields must be supplied together");
  }
});
// Also protect fresh documents and explicitly selected documents during ordinary serialization.
inboxSchema.set("toJSON", { transform: (_document, value) => {
  delete value.tokenHash;
  delete value.encryptedToken;
  return value;
} });
inboxSchema.set("toObject", { transform: (_document, value) => {
  delete value.tokenHash;
  delete value.encryptedToken;
  return value;
} });

export type Inbox = InferSchemaType<typeof inboxSchema>;

export function getInboxModel(connection: Connection) {
  return connection.model("Inbox", inboxSchema);
}

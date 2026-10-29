import { Schema, type Connection, type InferSchemaType } from "mongoose";

export const INBOX_NAME_MAX_LENGTH = 100;
export const INBOX_DESCRIPTION_MAX_LENGTH = 500;
export const RETENTION_DAYS = [1, 7, 30] as const;
export const DEFAULT_RETENTION_DAYS = 7;

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
  // Token storage is added with its generation/encryption invariants in D04.2.
}, {
  collection: "inboxes", timestamps: true, strict: "throw", strictQuery: "throw",
  bufferCommands: false, autoCreate: false, autoIndex: false,
});
inboxSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });

export type Inbox = InferSchemaType<typeof inboxSchema>;

export function getInboxModel(connection: Connection) {
  return connection.model("Inbox", inboxSchema);
}

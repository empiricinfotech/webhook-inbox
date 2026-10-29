import { Schema, type Connection, type InferSchemaType } from "mongoose";

export const WORKSPACE_NAME_MAX_LENGTH = 100;
export const WORKSPACE_STATES = ["active", "deleting"] as const;

export const workspaceSchema = new Schema({
  name: {
    type: String, required: true, cast: false, trim: true,
    minlength: 1, maxlength: WORKSPACE_NAME_MAX_LENGTH,
    validate: {
      validator: (value: string) => [...value].every((character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
      message: "Workspace name must not contain control characters" },
  },
  // A reference only; user existence and ownership authorization are later work.
  ownerId: { type: Schema.Types.ObjectId, required: true, cast: false },
  state: { type: String, required: true, cast: false, enum: WORKSPACE_STATES, default: "active" },
}, {
  collection: "workspaces", timestamps: true, strict: "throw", strictQuery: "throw",
  bufferCommands: false, autoCreate: false, autoIndex: false,
});
workspaceSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

export type Workspace = InferSchemaType<typeof workspaceSchema>;

// Compile on the caller-owned connection; importing this module never connects.
export function getWorkspaceModel(connection: Connection) {
  return connection.model("Workspace", workspaceSchema);
}

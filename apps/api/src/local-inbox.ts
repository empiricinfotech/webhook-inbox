import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Types } from "mongoose";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readLocalInboxEnvironment } from "./config/local-inbox.js";
import { connectDatabase, type Database } from "./database.js";
import { ApiError } from "./errors.js";
import { createCaptureTokenCrypto } from "./security/capture-token.js";
import { bootstrapLocalWorkspace } from "./services/local-workspace.js";
import { createInboxService } from "./services/inboxes.js";

let database: Database | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["init", "bootstrap", "create", "list"].includes(command)
    || (command === "create" ? args.length < 1 || args.length > 2 : args.length !== 0)) {
    throw new ApiError("INVALID_REQUEST");
  }
  if (command === "init") {
    // Explicit one-time provisioning; wx refuses existing files and symlinks, never rotates a key.
    await writeFile(".env.inbox.local", [
      "# Private local operator configuration. Preserve this key and these IDs.",
      "NODE_ENV=development", "MONGODB_URI=mongodb://127.0.0.1:27017/webhook_inbox?directConnection=true",
      `LOCAL_OWNER_ID=${new Types.ObjectId().toHexString()}`,
      `LOCAL_WORKSPACE_ID=${new Types.ObjectId().toHexString()}`,
      "LOCAL_WORKSPACE_NAME=Local workspace", "CAPTURE_TOKEN_KEY_VERSION=local-v1",
      `CAPTURE_TOKEN_KEY_HEX=${randomBytes(32).toString("hex")}`, "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ data: { status: "local_config_created" } }));
  } else {
    const config = readLocalInboxEnvironment();
    const crypto = createCaptureTokenCrypto({ currentVersion: config.CAPTURE_TOKEN_KEY_VERSION,
      keys: new Map([[config.CAPTURE_TOKEN_KEY_VERSION, Buffer.from(config.CAPTURE_TOKEN_KEY_HEX, "hex")]]) });
    database = await connectDatabase(config.MONGODB_URI);
    const ownerId = new Types.ObjectId(config.LOCAL_OWNER_ID);
    const workspaceId = new Types.ObjectId(config.LOCAL_WORKSPACE_ID);
    let data: unknown;
    if (command === "bootstrap") {
      data = await bootstrapLocalWorkspace(database.connection, { ownerId, workspaceId, name: config.LOCAL_WORKSPACE_NAME });
      // Initialize the inbox indexes before declaring local bootstrap ready.
      await createInboxService(database.connection, crypto);
    } else {
      const inboxes = await createInboxService(database.connection, crypto);
      const request = { actorId: ownerId, workspaceId };
      data = command === "create" ? await inboxes.createForOwner(request, {
        name: args[0], ...(args[1] === undefined ? {} : { description: args[1] }),
      }) : await inboxes.listForOwner(request);
    }
    console.log(JSON.stringify({ data }));
  }
} catch (error) {
  // Do not serialize input, argv, env, driver errors, token data or causes.
  const code = error instanceof ApiError ? error.code
    : error instanceof EnvironmentConfigurationError ? "INVALID_CONFIGURATION"
    : typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST" ? "CONFIG_ALREADY_EXISTS"
    : "LOCAL_COMMAND_FAILED";
  console.error(JSON.stringify({ error: { code } }));
  process.exitCode = 1;
} finally {
  try { await database?.close(); }
  catch { console.error(JSON.stringify({ error: { code: "LOCAL_COMMAND_FAILED" } })); process.exitCode = 1; }
}

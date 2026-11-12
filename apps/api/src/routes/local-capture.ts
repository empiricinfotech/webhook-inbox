import { Types, type Connection } from "mongoose";
import { ApiError } from "../errors.js";
import { createCaptureSanitizer, type CaptureRedactionOptions } from "../capture/sanitize.js";
import type { CaptureTokenCrypto } from "../security/capture-token.js";
import { createCaptureTokenService } from "../services/capture-tokens.js";
import { createCaptureEventStore } from "../services/capture-events.js";
import { createCaptureRouter } from "./capture.js";

// This composition is for the opt-in local dashboard, scoped to its trusted workspace.
// No session authentication, public deployment, signature verification or raw store.
export function createLocalCaptureRouter(connection: Connection, crypto: CaptureTokenCrypto,
  workspaceId: Types.ObjectId, policy: CaptureRedactionOptions = {}) {
  if (!(workspaceId instanceof Types.ObjectId)) throw new TypeError("Invalid local capture scope");
  const scope = workspaceId.toHexString();
  const lookup = createCaptureTokenService(connection, crypto);
  const sanitize = createCaptureSanitizer(policy);
  const store = createCaptureEventStore(connection);
  return createCaptureRouter({
    tokens: {
      async requireEnabledForCapture(token) {
        const inbox = await lookup.findByCaptureToken(token);
        // Check scope before enabled state, so foreign inboxes never reveal their state.
        if (!inbox || inbox.workspaceId.toHexString() !== scope) throw new ApiError("NOT_FOUND");
        if (!inbox.enabled) throw new ApiError("ENDPOINT_DISABLED");
        return inbox;
      },
    },
    async handle(input, response) {
      const eventId = await store(sanitize(input));
      if (input.method === "HEAD") response.status(201).end();
      else response.status(201).json({ data: { eventId, captured: true } });
    },
  });
}

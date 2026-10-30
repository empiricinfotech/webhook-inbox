import pino from "pino";
import { Types } from "mongoose";
import { z } from "zod";
import { EnvironmentConfigurationError, parseEnvironment } from "@empiric-webhook-inbox/contracts/environment";
import { readLocalInboxEnvironment } from "./config/local-inbox.js";
import { connectDatabase, type Database } from "./database.js";
import { readWebOrigin } from "./config/local-dashboard.js";
import { createCaptureTokenCrypto } from "./security/capture-token.js";
import { createLocalInboxRouter } from "./routes/local-inboxes.js";
import { startServer } from "./server.js";

const logger = pino();
let database: Database | undefined;
try {
  const config = readLocalInboxEnvironment();
  const extra = parseEnvironment(z.object({
    API_PORT: z.string().regex(/^[0-9]+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).default(4000),
    LOCAL_WEB_ORIGIN: z.string().default("http://127.0.0.1:3000").transform(readWebOrigin),
  }), { API_PORT: process.env.API_PORT, LOCAL_WEB_ORIGIN: process.env.LOCAL_WEB_ORIGIN });
  const crypto = createCaptureTokenCrypto({ currentVersion: config.CAPTURE_TOKEN_KEY_VERSION,
    keys: new Map([[config.CAPTURE_TOKEN_KEY_VERSION, Buffer.from(config.CAPTURE_TOKEN_KEY_HEX, "hex")]]) });
  database = await connectDatabase(config.MONGODB_URI);
  const connected = database;
  const routes = await createLocalInboxRouter(connected.connection, crypto, {
    actorId: new Types.ObjectId(config.LOCAL_OWNER_ID), workspaceId: new Types.ObjectId(config.LOCAL_WORKSPACE_ID),
    webOrigin: extra.LOCAL_WEB_ORIGIN, apiHost: `127.0.0.1:${extra.API_PORT}`,
  });
  let stopping = false;
  const server = await startServer({ NODE_ENV: config.NODE_ENV, MONGODB_URI: config.MONGODB_URI,
    API_PORT: extra.API_PORT, API_HOST: "127.0.0.1" }, () => connected.isReady(), logger, routes);
  logger.info({ host: "127.0.0.1", port: extra.API_PORT }, "Local dashboard API listening");
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 5000);
    deadline.unref();
    server.close(async () => {
      try { await connected.close(); }
      catch { process.exitCode = 1; }
      finally { clearTimeout(deadline); }
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  await database?.close().catch(() => {});
  logger.error({ code: error instanceof EnvironmentConfigurationError ? "INVALID_CONFIGURATION" : "LOCAL_DASHBOARD_STARTUP_FAILED" },
    "Local dashboard API could not start");
  process.exitCode = 1;
}

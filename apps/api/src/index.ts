import pino from "pino";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readApiEnvironment } from "./config/environment.js";
import { connectDatabase, DatabaseConnectionError, type Database } from "./database.js";
import { startServer } from "./server.js";

const logger = pino();
let database: Database | undefined;

try {
  const environment = readApiEnvironment();
  const connectedDatabase = await connectDatabase(environment.MONGODB_URI);
  database = connectedDatabase;
  let stopping = false;
  const server = await startServer(
    environment,
    () => stopping ? Promise.resolve(false) : connectedDatabase.isReady(),
    logger,
  );
  logger.info(
    { host: environment.API_HOST, port: environment.API_PORT },
    "API listening",
  );

  function shutdown() {
    if (stopping) return;
    stopping = true;
    logger.info("API stopping");
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 5000);
    deadline.unref();
    server.close(async (error) => {
      try {
        await connectedDatabase.close();
        if (error) throw error;
      } catch {
        logger.error("API shutdown failed");
        process.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  await database?.close().catch(() => {});
  if (error instanceof EnvironmentConfigurationError) {
    logger.error({ fields: error.fields }, "Invalid environment configuration");
  } else if (error instanceof DatabaseConnectionError) {
    logger.error({ code: "MONGODB_CONNECTION_FAILED" }, "MongoDB connection failed");
  } else {
    const code = error instanceof Error && "code" in error && error.code === "EADDRINUSE"
      ? "EADDRINUSE" : "API_STARTUP_FAILED";
    logger.error({ code }, "API failed to start");
  }
  process.exitCode = 1;
}

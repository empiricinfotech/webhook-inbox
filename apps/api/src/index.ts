import pino from "pino";
import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";
import { readApiEnvironment } from "./config/environment.js";
import { startServer } from "./server.js";

const logger = pino();

try {
  const environment = readApiEnvironment();
  const server = await startServer(environment);
  logger.info(
    { host: environment.API_HOST, port: environment.API_PORT },
    "API listening",
  );

  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    logger.info("API stopping");
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 5000);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      if (error) {
        logger.error("API shutdown failed");
        process.exitCode = 1;
      }
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  if (error instanceof EnvironmentConfigurationError) {
    logger.error({ fields: error.fields }, "Invalid environment configuration");
  } else {
    const code = error instanceof Error && "code" in error ? error.code : "UNKNOWN";
    logger.error({ code }, "API failed to start");
  }
  process.exitCode = 1;
}

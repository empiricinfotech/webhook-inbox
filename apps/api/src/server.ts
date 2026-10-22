import { createServer, type Server } from "node:http";
import { createApp, type ReadinessProbe } from "./app.js";
import type { ApiEnvironment } from "./config/environment.js";

export function startServer(
  environment: ApiEnvironment,
  isDatabaseReady: ReadinessProbe,
): Promise<Server> {
  const server = createServer(createApp(isDatabaseReady));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(environment.API_PORT, environment.API_HOST, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

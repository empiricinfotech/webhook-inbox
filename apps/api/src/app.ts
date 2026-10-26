import express from "express";
import { requestContext, type RequestLogger } from "./request-context.js";
import { errorHandler, notFound } from "./errors.js";

export type ReadinessProbe = () => Promise<boolean>;

export function createApp(isDatabaseReady: ReadinessProbe, logger?: RequestLogger) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(logger));

  app.get("/health/live", (_request, response) => {
    response.set("Cache-Control", "no-store").json({ data: { status: "live" } });
  });
  app.get("/health/ready", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    let ready = false;
    try {
      ready = await isDatabaseReady();
    } catch {
      // Probes must not leak driver errors through Express's default handler.
    }
    response.status(ready ? 200 : 503).json({
      data: { status: ready ? "ready" : "not_ready" },
    });
  });

  // Capture will need bounded original bytes; do not install a global body parser.
  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}

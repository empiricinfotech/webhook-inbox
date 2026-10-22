import express from "express";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Capture will need bounded original bytes; do not install a global body parser.
  app.use((_request, response) => {
    response.status(404).type("text/plain").send("Not found\n");
  });

  return app;
}

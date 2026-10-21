import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const api = createRequire(new URL("../apps/api/package.json", import.meta.url));
const worker = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const contracts = createRequire(new URL("../packages/contracts/package.json", import.meta.url));

const React = web("react");
const { renderToStaticMarkup } = web("react-dom/server");
assert.equal(
  renderToStaticMarkup(React.createElement("span", null, "<synthetic>")),
  "<span>&lt;synthetic&gt;</span>",
);
assert.equal(typeof web("next"), "function");
const query = new (web("@tanstack/react-query").QueryClient)();
query.setQueryData(["dependency-smoke"], { synthetic: true });
assert.deepEqual(query.getQueryData(["dependency-smoke"]), { synthetic: true });
query.clear();

const css = await web("postcss")([
  web("@tailwindcss/postcss")({
    base: fileURLToPath(new URL("../apps/web/", import.meta.url)),
  }),
]).process(".synthetic { @apply flex; }", { from: undefined });
assert.match(css.css, /display:\s*flex/);

assert.equal(typeof api("express").Router(), "function");
const mongoose = api("mongoose");
const Sample = mongoose.model("DependencySmoke", new mongoose.Schema({
  count: { type: Number, required: true },
}));
await new Sample({ count: 1 }).validate();
mongoose.deleteModel("DependencySmoke");
assert.deepEqual(api("zod").z.object({ synthetic: api("zod").z.literal(true) }).parse({
  synthetic: true,
}), { synthetic: true });
assert.equal(worker("mongoose").version, mongoose.version);
assert.equal(typeof worker("pino"), "function");
assert.equal(typeof worker("zod").z.object, "function");
assert.equal(typeof contracts("zod").z.object, "function");

const records = [];
const sink = new Writable({
  write(chunk, encoding, callback) {
    records.push(chunk.toString());
    callback();
  },
});
api("pino")({}, sink).info({ synthetic: true }, "dependency compatibility");
assert.equal(JSON.parse(records.join("")).synthetic, true);
sink.end();

console.log("Dependency smoke checks passed: React rendering, Next.js import, query cache, Tailwind/PostCSS, Express, Mongoose validation, Zod, Pino, and worker/contracts resolution.");
console.log("No application server was started and no database connection was made.");

import {
  nodeEnvironmentSchema,
  parseEnvironment,
} from "@empiric-webhook-inbox/contracts/environment";
import { z } from "zod";

const apiOriginSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}).transform((value) => new URL(value).origin);

export const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
  API_ORIGIN: apiOriginSchema.optional(),
});

// Only Next configuration reads this; no server values are passed to the browser.
export function readWebEnvironment(source: Record<string, string | undefined> = process.env, requireApiOrigin = false) {
  const schema = requireApiOrigin
    ? webEnvironmentSchema.extend({ API_ORIGIN: apiOriginSchema })
    : webEnvironmentSchema;
  return parseEnvironment(schema, {
    NODE_ENV: source.NODE_ENV,
    ...(source.API_ORIGIN === undefined ? {} : { API_ORIGIN: source.API_ORIGIN }),
  });
}

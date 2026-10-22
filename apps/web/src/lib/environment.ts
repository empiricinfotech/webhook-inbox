import {
  nodeEnvironmentSchema,
  parseEnvironment,
} from "@empiric-webhook-inbox/contracts/environment";
import { z } from "zod";

export const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
});

// Used only by Next configuration. No server values are passed to the browser.
export function readWebEnvironment(source = process.env) {
  return parseEnvironment(webEnvironmentSchema, { NODE_ENV: source.NODE_ENV });
}

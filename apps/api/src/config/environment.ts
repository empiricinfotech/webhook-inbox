import { z } from "zod";
import {
  nodeEnvironmentSchema,
  parseEnvironment,
} from "@empiric-webhook-inbox/contracts/environment";

export const apiEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
  API_HOST: z.enum(["127.0.0.1", "::1"]).default("127.0.0.1"),
  API_PORT: z.string().regex(/^[0-9]+$/).transform(Number).pipe(
    z.number().int().min(1).max(65535),
  ),
});

export type ApiEnvironment = z.output<typeof apiEnvironmentSchema>;

export function readApiEnvironment(source = process.env): ApiEnvironment {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: source.NODE_ENV,
    API_HOST: source.API_HOST,
    API_PORT: source.API_PORT,
  });
}

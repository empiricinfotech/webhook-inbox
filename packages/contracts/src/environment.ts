import { z } from "zod";

export const nodeEnvironmentSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export class EnvironmentConfigurationError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid environment configuration: ${fields.join(", ")}`);
    this.name = "EnvironmentConfigurationError";
  }
}

// Report schema field names only; Zod issue messages can contain input values.
export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(
      (issue) => String(issue.path[0]),
    ))].sort();
    throw new EnvironmentConfigurationError(fields);
  }
  return result.data;
}

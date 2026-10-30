import { EnvironmentConfigurationError } from "@empiric-webhook-inbox/contracts/environment";

export function readWebOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new EnvironmentConfigurationError(["LOCAL_WEB_ORIGIN"]); }
}

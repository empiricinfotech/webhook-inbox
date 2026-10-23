import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { readWebEnvironment } from "./src/lib/environment.ts";

export default function nextConfig(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const environment = readWebEnvironment(process.env, development);
  return {
    poweredByHeader: false,
    reactStrictMode: true,
    transpilePackages: ["@empiric-webhook-inbox/contracts"],
    async rewrites() {
      return development && environment.API_ORIGIN ? [{
        source: "/api/v1/:path*",
        destination: `${environment.API_ORIGIN}/api/v1/:path*`,
      }] : [];
    },
  };
}

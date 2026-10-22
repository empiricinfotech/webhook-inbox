import type { NextConfig } from "next";
import { readWebEnvironment } from "./src/lib/environment.ts";

readWebEnvironment();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@empiric-webhook-inbox/contracts"],
};

export default nextConfig;

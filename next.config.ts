import type { NextConfig } from "next";

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "dev";

const nextConfig: NextConfig = {
  // Hide the floating "Rendering..." / "Compiling..." pill in development.
  devIndicators: false,
  env: {
    // Baked into the client bundle so a new deploy can be detected by polling.
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;

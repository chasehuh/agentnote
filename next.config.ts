import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating "Rendering..." / "Compiling..." pill in development.
  devIndicators: false,
};

export default nextConfig;

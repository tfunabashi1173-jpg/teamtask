import type { NextConfig } from "next";
import { BUILD_APP_VERSION, BUILD_COMMIT_SHA } from "./src/lib/build-metadata";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: BUILD_APP_VERSION.replace(/^v/, ""),
    NEXT_PUBLIC_COMMIT_SHA: BUILD_COMMIT_SHA,
  },
};

export default nextConfig;

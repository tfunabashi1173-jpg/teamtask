import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { version } from "./package.json";

function resolveCommitSha() {
  const envSha =
    process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.GITHUB_SHA?.slice(0, 7) ??
    process.env.SOURCE_COMMIT?.slice(0, 7) ??
    process.env.COMMIT_SHA?.slice(0, 7);

  if (envSha) {
    return envSha;
  }

  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
  },
};

export default nextConfig;

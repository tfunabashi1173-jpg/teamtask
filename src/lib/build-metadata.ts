import { execSync } from "node:child_process";
import packageJson from "../../package.json";

function resolveCommitShaFallback() {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export const BUILD_COMMIT_SHA =
  process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ??
  process.env.SOURCE_COMMIT?.slice(0, 7) ??
  process.env.COMMIT_SHA?.slice(0, 7) ??
  process.env.GITHUB_SHA?.slice(0, 7) ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  resolveCommitShaFallback();

export const BUILD_APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || `v${packageJson.version}`;

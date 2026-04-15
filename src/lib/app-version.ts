import { execSync } from "node:child_process";
import packageJson from "../../package.json";

export function resolveCommitSha() {
  const envSha =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.GITHUB_SHA?.slice(0, 7);

  if (envSha) {
    return envSha;
  }

  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "devbuild";
  }
}

export function resolveAppVersion() {
  return `v${packageJson.version}`;
}

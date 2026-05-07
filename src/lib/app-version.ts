import packageJson from "../../package.json";

export function resolveCommitSha() {
  return (
    process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ??
    process.env.SOURCE_COMMIT?.slice(0, 7) ??
    process.env.COMMIT_SHA?.slice(0, 7) ??
    process.env.GITHUB_SHA?.slice(0, 7) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    "unknown"
  );
}

export function resolveAppVersion() {
  return `v${packageJson.version}`;
}

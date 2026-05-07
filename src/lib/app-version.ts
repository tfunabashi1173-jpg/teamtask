import packageJson from "../../package.json";

export function resolveCommitSha() {
  return process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown";
}

export function resolveAppVersion() {
  return `v${packageJson.version}`;
}

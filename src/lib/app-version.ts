import { BUILD_APP_VERSION, BUILD_COMMIT_SHA } from "@/lib/build-metadata";

export function resolveCommitSha() {
  return BUILD_COMMIT_SHA;
}

export function resolveAppVersion() {
  return BUILD_APP_VERSION;
}

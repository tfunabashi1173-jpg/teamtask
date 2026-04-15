import { execSync } from "node:child_process";
import packageJson from "../../package.json";
import { TaskBoard } from "@/components/task-board";
import { getAppState } from "@/lib/app-data";
import { readSessionUser } from "@/lib/auth/server-session";

function resolveCommitSha() {
  const envSha =
    process.env.NEXT_PUBLIC_APP_COMMIT_SHA?.slice(0, 7) ??
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

const commitSha =
  resolveCommitSha();

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string; invite?: string }>;
}) {
  const sessionUser = await readSessionUser();
  const resolvedSearchParams = await searchParams;
  const appState = await getAppState({
    sessionLineUserId: sessionUser?.lineUserId ?? null,
    inviteToken: resolvedSearchParams.invite ?? null,
  });

  return (
    <TaskBoard
      appVersion={`v${packageJson.version}`}
      commitSha={commitSha}
      authError={resolvedSearchParams.authError ?? null}
      sessionUser={sessionUser}
      initialState={appState}
      inviteToken={resolvedSearchParams.invite ?? null}
    />
  );
}

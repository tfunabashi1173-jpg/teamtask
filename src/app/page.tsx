import { TaskBoard } from "@/components/task-board";
import { getAppState } from "@/lib/app-data";
import { resolveAppVersion, resolveCommitSha } from "@/lib/app-version";
import { readSessionUser } from "@/lib/auth/server-session";

const commitSha = resolveCommitSha();
const appVersion = resolveAppVersion();

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    authError?: string;
    invite?: string;
    authSuccess?: string;
    loginAttempt?: string;
  }>;
}) {
  const sessionUser = await readSessionUser();
  const resolvedSearchParams = await searchParams;
  const appState = await getAppState({
    sessionLineUserId: sessionUser?.lineUserId ?? null,
    sessionPictureUrl: sessionUser?.pictureUrl ?? null,
    inviteToken: resolvedSearchParams.invite ?? null,
  });

  return (
    <TaskBoard
      appVersion={appVersion}
      commitSha={commitSha}
      authError={resolvedSearchParams.authError ?? null}
      authSuccess={resolvedSearchParams.authSuccess === "1"}
      loginAttempt={resolvedSearchParams.loginAttempt ?? null}
      sessionUser={sessionUser}
      initialState={appState}
      inviteToken={resolvedSearchParams.invite ?? null}
    />
  );
}

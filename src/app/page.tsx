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
    lineAuth?: string;
    loginStarted?: string;
    pwaReturn?: string;
    next?: string;
  }>;
}) {
  const sessionUser = await readSessionUser();
  const resolvedSearchParams = await searchParams;
  const appState = await getAppState({
    sessionLineUserId: sessionUser?.lineUserId ?? null,
    inviteToken: resolvedSearchParams.invite ?? null,
  });

  return (
    <TaskBoard
      appVersion={appVersion}
      commitSha={commitSha}
      authError={resolvedSearchParams.authError ?? null}
      authSuccess={resolvedSearchParams.authSuccess === "1"}
      lineAuthFlow={resolvedSearchParams.lineAuth === "1"}
      loginStarted={resolvedSearchParams.loginStarted === "1"}
      pwaReturn={resolvedSearchParams.pwaReturn === "1"}
      nextUrl={resolvedSearchParams.next ?? null}
      sessionUser={sessionUser}
      initialState={appState}
      inviteToken={resolvedSearchParams.invite ?? null}
    />
  );
}

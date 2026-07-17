import { cookies, headers } from "next/headers";
import {
  createSessionCookieValue,
  getSessionCookieName,
  getSessionMaxAge,
  parseSessionCookieValue,
  shouldRefreshSession,
  type SessionUser,
} from "@/lib/auth/session";

export async function readSession() {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const headerToken = requestHeaders.get("x-team-task-session");
  const cookieStore = await cookies();
  const rawValue = bearerToken || headerToken || cookieStore.get(getSessionCookieName())?.value;
  const session = parseSessionCookieValue(rawValue);

  if (!session) {
    return null;
  }

  return {
    user: {
      lineUserId: session.lineUserId,
      displayName: session.displayName,
      pictureUrl: session.pictureUrl ?? null,
    },
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

export async function readSessionUser() {
  const session = await readSession();
  return session?.user ?? null;
}

export function createSessionToken(user: SessionUser) {
  return createSessionCookieValue(user);
}

export async function writeSessionCookie(user: SessionUser) {
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), createSessionCookieValue(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: getSessionMaxAge(),
  });
}

export async function refreshSessionCookieIfNeeded(session: { user: SessionUser; expiresAt: number } | null) {
  if (!session || !shouldRefreshSession(session.expiresAt)) {
    return;
  }

  await writeSessionCookie(session.user);
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

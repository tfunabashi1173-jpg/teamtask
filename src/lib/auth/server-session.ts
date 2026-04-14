import { cookies } from "next/headers";
import {
  createSessionCookieValue,
  getSessionCookieName,
  getSessionMaxAge,
  parseSessionCookieValue,
  type SessionUser,
} from "@/lib/auth/session";

export async function readSessionUser() {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(getSessionCookieName())?.value;
  const session = parseSessionCookieValue(rawValue);

  if (!session) {
    return null;
  }

  return {
    lineUserId: session.lineUserId,
    displayName: session.displayName,
  };
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

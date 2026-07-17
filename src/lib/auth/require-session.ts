import { NextResponse } from "next/server";
import { readSession, refreshSessionCookieIfNeeded } from "@/lib/auth/server-session";

export async function requireSession() {
  const session = await readSession();
  const sessionUser = session?.user ?? null;

  if (!sessionUser) {
    return {
      sessionUser: null,
      errorResponse: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }

  await refreshSessionCookieIfNeeded(session);

  return { sessionUser, errorResponse: null };
}

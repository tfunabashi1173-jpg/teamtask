import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/auth/server-session";

export async function requireSession() {
  const sessionUser = await readSessionUser();

  if (!sessionUser) {
    return {
      sessionUser: null,
      errorResponse: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }

  return { sessionUser, errorResponse: null };
}

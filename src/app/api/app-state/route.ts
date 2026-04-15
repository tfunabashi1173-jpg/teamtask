import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/auth/server-session";
import { getAppState } from "@/lib/app-data";

export async function GET(request: Request) {
  const sessionUser = await readSessionUser();
  const url = new URL(request.url);
  const inviteToken = url.searchParams.get("invite");

  const state = await getAppState({
    sessionLineUserId: sessionUser?.lineUserId ?? null,
    inviteToken,
  });

  return NextResponse.json({
    ok: true,
    state,
  });
}

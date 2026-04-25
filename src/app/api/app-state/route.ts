import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/auth/server-session";
import { getAppState } from "@/lib/app-data";

export async function GET(request: Request) {
  try {
    const sessionUser = await readSessionUser();
    const url = new URL(request.url);
    const inviteToken = url.searchParams.get("invite");

    const state = await getAppState({
      sessionLineUserId: sessionUser?.lineUserId ?? null,
      sessionPictureUrl: sessionUser?.pictureUrl ?? null,
      inviteToken,
    });

    return NextResponse.json({
      ok: true,
      state,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

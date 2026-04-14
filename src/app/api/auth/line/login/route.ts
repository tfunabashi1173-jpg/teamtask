import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createLineAuthorizeUrl } from "@/lib/auth/line";
import {
  createLineState,
  createSignedState,
  getLineStateCookieName,
} from "@/lib/auth/session";

export async function GET() {
  try {
    const state = createLineState();
    const nonce = createLineState();
    const cookieStore = await cookies();

    cookieStore.set(getLineStateCookieName(), createSignedState(state), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });

    return NextResponse.redirect(createLineAuthorizeUrl({ state, nonce }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start LINE login.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

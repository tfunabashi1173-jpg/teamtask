import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createLineAuthorizeUrl, resolveLineRedirectUri } from "@/lib/auth/line";
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

    const redirectUri = resolveLineRedirectUri("web");
    const authorizeUrl = createLineAuthorizeUrl({ state, nonce, redirectUri });
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start LINE login.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

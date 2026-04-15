import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createLineAuthorizeUrl } from "@/lib/auth/line";
import {
  createLineState,
  createSignedState,
  getLineStateCookieName,
} from "@/lib/auth/session";

function resolveAppOrigin(request: NextRequest) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (configuredUrl) {
    return new URL(configuredUrl).origin;
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
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

    const authorizeUrl = createLineAuthorizeUrl({ state, nonce });
    const returnUrl = new URL("/", resolveAppOrigin(request));
    returnUrl.searchParams.set("loginStarted", "1");
    returnUrl.searchParams.set("lineAuth", "1");
    returnUrl.searchParams.set("next", authorizeUrl);

    return NextResponse.redirect(returnUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start LINE login.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

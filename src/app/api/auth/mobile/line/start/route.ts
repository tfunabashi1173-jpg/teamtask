import { NextRequest, NextResponse } from "next/server";
import { createLineAuthorizeUrl, resolveLineRedirectUri } from "@/lib/auth/line";
import { createLineState } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const redirectUri = request.nextUrl.searchParams.get("redirect_uri");

  if (!redirectUri) {
    return NextResponse.json({ error: "REDIRECT_URI_REQUIRED" }, { status: 400 });
  }

  const state = createLineState();
  const nonce = createLineState();
  const lineRedirectUri = resolveLineRedirectUri("mobile");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const supabase = createSupabaseAdminClient();

  const insertResult = await supabase
    .from("mobile_auth_sessions")
    .insert({
      oauth_state: state,
      redirect_uri: redirectUri,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.redirect(createLineAuthorizeUrl({ state, nonce, redirectUri: lineRedirectUri }));
}

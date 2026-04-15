import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchLineProfile,
  verifyIdToken,
} from "@/lib/auth/line";
import { createSessionToken } from "@/lib/auth/server-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function buildErrorRedirect(redirectUri: string, message: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const lineError = request.nextUrl.searchParams.get("error");

  if (!state) {
    return NextResponse.json({ error: "STATE_REQUIRED" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const sessionResult = await supabase
    .from("mobile_auth_sessions")
    .select("id,redirect_uri,expires_at")
    .eq("oauth_state", state)
    .maybeSingle();

  if (
    sessionResult.error ||
    !sessionResult.data ||
    new Date(sessionResult.data.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  }

  if (lineError) {
    await supabase
      .from("mobile_auth_sessions")
      .update({ status: "failed", error_message: "LINE login cancelled." })
      .eq("id", sessionResult.data.id);
    return buildErrorRedirect(sessionResult.data.redirect_uri, "cancelled");
  }

  if (!code) {
    await supabase
      .from("mobile_auth_sessions")
      .update({ status: "failed", error_message: "LINE login response is invalid." })
      .eq("id", sessionResult.data.id);
    return buildErrorRedirect(sessionResult.data.redirect_uri, "invalid_response");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    let displayName: string | null = null;
    let lineUserId: string | null = null;
    let pictureUrl: string | null = null;

    if (tokens.id_token) {
      const verifiedToken = await verifyIdToken(tokens.id_token);
      displayName = verifiedToken.name ?? null;
      lineUserId = verifiedToken.sub;
      pictureUrl = verifiedToken.picture ?? null;
    }

    const profile = await fetchLineProfile(tokens.access_token);
    lineUserId = lineUserId ?? profile.userId;
    displayName = displayName ?? profile.displayName;
    pictureUrl = pictureUrl ?? profile.pictureUrl ?? null;

    if (!lineUserId) {
      throw new Error("LINE user not found.");
    }

    await supabase
      .from("app_users")
      .update({ line_picture_url: pictureUrl })
      .eq("line_user_id", lineUserId);

    const sessionToken = createSessionToken({
      lineUserId,
      displayName,
      pictureUrl,
    });

    await supabase
      .from("mobile_auth_sessions")
      .update({
        status: "completed",
        session_token: sessionToken,
        line_user_id: lineUserId,
        display_name: displayName,
        picture_url: pictureUrl,
        error_message: null,
      })
      .eq("id", sessionResult.data.id);

    const redirectUrl = new URL(sessionResult.data.redirect_uri);
    redirectUrl.searchParams.set("request_id", sessionResult.data.id);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    await supabase
      .from("mobile_auth_sessions")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "LINE login failed.",
      })
      .eq("id", sessionResult.data.id);
    return buildErrorRedirect(sessionResult.data.redirect_uri, "login_failed");
  }
}

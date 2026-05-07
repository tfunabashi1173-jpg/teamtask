import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchLineProfile,
  resolveLineRedirectUri,
  verifyIdToken,
} from "@/lib/auth/line";
import { writeSessionCookie } from "@/lib/auth/server-session";
import {
  getLineStateCookieName,
} from "@/lib/auth/session";
import { getAppBaseUrl } from "@/lib/app-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function redirectWithError(request: NextRequest, message: string) {
  const url = getAppBaseUrl(request);
  url.searchParams.set("authError", message);
  const response = NextResponse.redirect(url);
  response.cookies.set(getLineStateCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const lineError = searchParams.get("error");

  if (lineError) {
    return redirectWithError(request, "LINEログインがキャンセルされました。");
  }

  if (!code || !state) {
    return redirectWithError(request, "LINEログインの応答が不正です。");
  }

  try {
    const redirectUri = resolveLineRedirectUri("web");
    const supabase = createSupabaseAdminClient();
    const loginAttemptResult = await supabase
      .from("line_login_attempts")
      .select("id,status,expires_at")
      .eq("oauth_state", state)
      .maybeSingle();

    if (
      loginAttemptResult.error ||
      !loginAttemptResult.data ||
      new Date(loginAttemptResult.data.expires_at).getTime() <= Date.now()
    ) {
      return redirectWithError(request, "ログイン状態の確認に失敗しました。");
    }

    const tokens = await exchangeCodeForTokens(code, redirectUri);
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
      return redirectWithError(request, "LINEユーザー情報を取得できませんでした。");
    }

    await supabase
      .from("app_users")
      .update({
        line_picture_url: pictureUrl,
      })
      .eq("line_user_id", lineUserId);

    await writeSessionCookie({
      lineUserId,
      displayName,
      pictureUrl,
    });

    await supabase
      .from("line_login_attempts")
      .update({
        status: "completed",
        session_payload: {
          lineUserId,
          displayName,
          pictureUrl,
        },
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", loginAttemptResult.data.id);

    const successUrl = getAppBaseUrl(request);
    successUrl.searchParams.set("authSuccess", "1");
    successUrl.searchParams.set("loginAttempt", loginAttemptResult.data.id);

    const response = NextResponse.redirect(successUrl);
    response.cookies.set(getLineStateCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    await createSupabaseAdminClient()
      .from("line_login_attempts")
      .update({
        status: "failed",
        error_message:
          error instanceof Error ? error.message : "LINEログインの処理に失敗しました。",
      })
      .eq("oauth_state", state);

    const message =
      error instanceof Error
        ? error.message
        : "LINEログインの処理に失敗しました。";

    return redirectWithError(request, message);
  }
}

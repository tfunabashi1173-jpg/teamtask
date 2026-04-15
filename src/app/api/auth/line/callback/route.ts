import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchLineProfile,
  verifyIdToken,
} from "@/lib/auth/line";
import { writeSessionCookie } from "@/lib/auth/server-session";
import {
  getLineStateCookieName,
  verifySignedState,
} from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function redirectWithError(request: NextRequest, message: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("authError", message);
  return NextResponse.redirect(url);
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

  const cookieStore = await cookies();
  const signedState = cookieStore.get(getLineStateCookieName())?.value;

  if (!verifySignedState(signedState, state)) {
    return redirectWithError(request, "ログイン状態の確認に失敗しました。");
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
      return redirectWithError(request, "LINEユーザー情報を取得できませんでした。");
    }

    const supabase = createSupabaseAdminClient();
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

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(getLineStateCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "LINEログインの処理に失敗しました。";

    return redirectWithError(request, message);
  }
}

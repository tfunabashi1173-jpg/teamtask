import { NextResponse } from "next/server";
import { createLineAuthorizeUrl } from "@/lib/auth/line";
import { createLineState } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = createSupabaseAdminClient();
    const state = createLineState();
    const nonce = createLineState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const insertResult = await supabase
      .from("line_login_attempts")
      .insert({
        oauth_state: state,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertResult.error || !insertResult.data) {
      throw new Error("LINEログインの開始情報を保存できませんでした。");
    }

    return NextResponse.json({
      ok: true,
      attemptId: insertResult.data.id,
      authorizeUrl: createLineAuthorizeUrl({ state, nonce }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LINEログインの開始に失敗しました。";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

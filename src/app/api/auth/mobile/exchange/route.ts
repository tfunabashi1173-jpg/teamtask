import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { requestId?: string } | null;
  const requestId = body?.requestId;

  if (!requestId) {
    return NextResponse.json({ error: "REQUEST_ID_REQUIRED" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const sessionResult = await supabase
    .from("mobile_auth_sessions")
    .select("id,status,expires_at,session_token,line_user_id,display_name,picture_url,consumed_at")
    .eq("id", requestId)
    .maybeSingle();

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  }

  if (new Date(sessionResult.data.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 410 });
  }

  if (sessionResult.data.status !== "completed" || !sessionResult.data.session_token) {
    return NextResponse.json({ error: "SESSION_NOT_READY" }, { status: 409 });
  }

  await supabase
    .from("mobile_auth_sessions")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return NextResponse.json({
    ok: true,
    sessionToken: sessionResult.data.session_token,
    user: {
      lineUserId: sessionResult.data.line_user_id,
      displayName: sessionResult.data.display_name,
      pictureUrl: sessionResult.data.picture_url,
    },
  });
}

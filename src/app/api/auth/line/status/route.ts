import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const attemptId = url.searchParams.get("attemptId");

  if (!attemptId) {
    return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("line_login_attempts")
    .select("status,expires_at,error_message")
    .eq("id", attemptId)
    .maybeSingle();

  if (result.error) {
    return NextResponse.json({ error: "Failed to load login attempt." }, { status: 500 });
  }

  if (!result.data) {
    return NextResponse.json({ ok: true, status: "not_found" });
  }

  const isExpired = new Date(result.data.expires_at).getTime() <= Date.now();
  const status =
    isExpired && result.data.status === "pending" ? "expired" : result.data.status;

  return NextResponse.json({
    ok: true,
    status,
    error: result.data.error_message ?? null,
  });
}

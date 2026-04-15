import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function PATCH(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as { notificationTime?: string };
  const notificationTime = body.notificationTime?.slice(0, 5);

  if (!notificationTime || !/^\d{2}:\d{2}$/.test(notificationTime)) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id,role")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  if (actorResult.data.role !== "admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const workspaceMemberResult = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  if (!workspaceMemberResult.data?.workspace_id) {
    return NextResponse.json({ error: "WORKSPACE_NOT_FOUND" }, { status: 404 });
  }

  const updateResult = await supabase
    .from("workspaces")
    .update({ notification_time: notificationTime })
    .eq("id", workspaceMemberResult.data.workspace_id)
    .select("id,name,timezone,notification_time")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, workspace: updateResult.data });
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { userId } = await context.params;
  const supabase = createSupabaseAdminClient();

  const adminResult = await supabase
    .from("app_users")
    .select("id,role")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (adminResult.error || adminResult.data.role !== "admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const targetResult = await supabase
    .from("app_users")
    .select("display_name")
    .eq("id", userId)
    .single();

  const now = new Date().toISOString();
  await Promise.all([
    supabase
      .from("app_users")
      .update({ is_active: false, deactivated_at: now })
      .eq("id", userId),
    supabase
      .from("workspace_members")
      .update({ is_active: false, left_at: now })
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("group_members")
      .update({ is_active: false, left_at: now })
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase.from("task_activity_logs").insert({
      actor_user_id: adminResult.data.id,
      action_type: "member_removed",
      after_value: { memberName: targetResult.data?.display_name ?? null },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

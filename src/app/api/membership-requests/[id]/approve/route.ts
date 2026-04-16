import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();

  const adminResult = await supabase
    .from("app_users")
    .select("id,role")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (adminResult.error || adminResult.data.role !== "admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const requestResult = await supabase
    .from("membership_requests")
    .select("id,workspace_id,group_id,line_user_id,requested_name,status")
    .eq("id", id)
    .single();

  if (requestResult.error || requestResult.data.status !== "pending") {
    return NextResponse.json({ error: "REQUEST_NOT_FOUND" }, { status: 404 });
  }

  const existingUserResult = await supabase
    .from("app_users")
    .select("id,is_active")
    .eq("line_user_id", requestResult.data.line_user_id)
    .maybeSingle();

  let userId = existingUserResult.data?.id as string | undefined;

  if (!userId) {
    const createUserResult = await supabase
      .from("app_users")
      .insert({
        line_user_id: requestResult.data.line_user_id,
        display_name: requestResult.data.requested_name,
        role: "member",
        is_active: true,
      })
      .select("id")
      .single();

    if (createUserResult.error) {
      return NextResponse.json({ error: createUserResult.error.message }, { status: 500 });
    }

    userId = createUserResult.data.id;
  } else {
    const reactivateUserResult = await supabase
      .from("app_users")
      .update({
        display_name: requestResult.data.requested_name,
        is_active: true,
        deactivated_at: null,
      })
      .eq("id", userId);

    if (reactivateUserResult.error) {
      return NextResponse.json({ error: reactivateUserResult.error.message }, { status: 500 });
    }
  }

  const workspaceMemberUpsert = await supabase.from("workspace_members").upsert({
    workspace_id: requestResult.data.workspace_id,
    user_id: userId,
    is_active: true,
    left_at: null,
  }, { onConflict: "workspace_id,user_id" });

  if (workspaceMemberUpsert.error) {
    return NextResponse.json({ error: workspaceMemberUpsert.error.message }, { status: 500 });
  }

  const groupMemberUpsert = await supabase.from("group_members").upsert({
    group_id: requestResult.data.group_id,
    user_id: userId,
    is_active: true,
    left_at: null,
  }, { onConflict: "group_id,user_id" });

  if (groupMemberUpsert.error) {
    return NextResponse.json({ error: groupMemberUpsert.error.message }, { status: 500 });
  }

  const [approveResult, logInsertResult] = await Promise.all([
    supabase
      .from("membership_requests")
      .update({
        status: "approved",
        approved_by: adminResult.data.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id),
    supabase.from("task_activity_logs").insert({
      task_id: null,
      actor_user_id: adminResult.data.id,
      action_type: "member_joined",
      after_value: { memberName: requestResult.data.requested_name },
    }),
  ]);

  if (approveResult.error) {
    return NextResponse.json({ error: approveResult.error.message }, { status: 500 });
  }

  if (logInsertResult.error) {
    return NextResponse.json({ error: logInsertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

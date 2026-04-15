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

  const { id: groupId } = await context.params;
  const supabase = createSupabaseAdminClient();

  const actorResult = await supabase
    .from("app_users")
    .select("id,role,is_active")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error || !actorResult.data.is_active) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const membershipResult = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true)
    .is("left_at", null)
    .maybeSingle();

  if (membershipResult.error || !membershipResult.data) {
    return NextResponse.json({ error: "MEMBERSHIP_NOT_FOUND" }, { status: 404 });
  }

  const groupResult = await supabase
    .from("groups")
    .select("id,workspace_id,name")
    .eq("id", groupId)
    .eq("is_active", true)
    .single();

  if (groupResult.error || !groupResult.data) {
    return NextResponse.json({ error: "GROUP_NOT_FOUND" }, { status: 404 });
  }

  const remainingGroupMembershipsResult = await supabase
    .from("group_members")
    .select("group_id", { count: "exact", head: true })
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true)
    .is("left_at", null)
    .neq("group_id", groupId);

  const willLeaveWorkspace = (remainingGroupMembershipsResult.count ?? 0) === 0;

  if (actorResult.data.role === "admin" && willLeaveWorkspace) {
    const otherWorkspaceMembersResult = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", groupResult.data.workspace_id)
      .eq("is_active", true)
      .is("left_at", null)
      .neq("user_id", actorResult.data.id);

    const otherUserIds =
      ((otherWorkspaceMembersResult.data as { user_id: string }[] | null) ?? []).map(
        (row) => row.user_id,
      );

    let otherActiveAdminCount = 0;
    if (otherUserIds.length > 0) {
      const otherAdminsResult = await supabase
        .from("app_users")
        .select("id", { count: "exact", head: true })
        .in("id", otherUserIds)
        .eq("role", "admin")
        .eq("is_active", true);

      otherActiveAdminCount = otherAdminsResult.count ?? 0;
    }

    if (otherActiveAdminCount === 0) {
      return NextResponse.json({ error: "LAST_ADMIN_CANNOT_LEAVE" }, { status: 409 });
    }
  }

  const now = new Date().toISOString();

  const leaveGroupResult = await supabase
    .from("group_members")
    .update({
      is_active: false,
      left_at: now,
    })
    .eq("group_id", groupId)
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true);

  if (leaveGroupResult.error) {
    return NextResponse.json({ error: leaveGroupResult.error.message }, { status: 500 });
  }

  if (willLeaveWorkspace) {
    const leaveWorkspaceResult = await supabase
      .from("workspace_members")
      .update({
        is_active: false,
        left_at: now,
      })
      .eq("workspace_id", groupResult.data.workspace_id)
      .eq("user_id", actorResult.data.id)
      .eq("is_active", true);

    if (leaveWorkspaceResult.error) {
      return NextResponse.json({ error: leaveWorkspaceResult.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    groupId,
    groupName: groupResult.data.name,
    leftWorkspace: willLeaveWorkspace,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sendMembershipRequestNotification } from "@/lib/notifications/web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    inviteToken?: string;
    requestedName?: string;
  };

  const inviteToken = body.inviteToken?.trim();
  const requestedName = body.requestedName?.trim();

  if (!inviteToken || !requestedName) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const existingUser = await supabase
    .from("app_users")
    .select("id,is_active")
    .eq("line_user_id", sessionUser.lineUserId)
    .maybeSingle();

  const inviteResult = await supabase
    .from("member_invites")
    .select("id,workspace_id,group_id,expires_at,is_active")
    .eq("invite_token", inviteToken)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!inviteResult.data) {
    return NextResponse.json({ error: "INVALID_INVITE" }, { status: 404 });
  }

  if (existingUser.data) {
    const activeMembership = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", inviteResult.data.group_id)
      .eq("user_id", existingUser.data.id)
      .eq("is_active", true)
      .is("left_at", null)
      .maybeSingle();

    if (activeMembership.data) {
      return NextResponse.json({ error: "ALREADY_MEMBER" }, { status: 409 });
    }
  }

  const pendingRequest = await supabase
    .from("membership_requests")
    .select("id")
    .eq("workspace_id", inviteResult.data.workspace_id)
    .eq("line_user_id", sessionUser.lineUserId)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRequest.data) {
    return NextResponse.json({ error: "DUPLICATE_REQUEST" }, { status: 409 });
  }

  const insertResult = await supabase.from("membership_requests").insert({
    workspace_id: inviteResult.data.workspace_id,
    group_id: inviteResult.data.group_id,
    invite_id: inviteResult.data.id,
    line_user_id: sessionUser.lineUserId,
    requested_name: requestedName,
    status: "pending",
  });

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await sendMembershipRequestNotification({
    workspaceId: inviteResult.data.workspace_id,
    requestedName,
    baseUrl: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ ok: true });
}

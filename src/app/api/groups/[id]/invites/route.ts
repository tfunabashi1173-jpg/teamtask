import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getAppBaseUrl } from "@/lib/app-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
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
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const groupMembership = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!groupMembership.data) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const inviteToken = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const groupResult = await supabase
    .from("groups")
    .select("workspace_id")
    .eq("id", groupId)
    .eq("is_active", true)
    .maybeSingle();

  if (!groupResult.data?.workspace_id) {
    return NextResponse.json({ error: "GROUP_NOT_FOUND" }, { status: 404 });
  }

  const insertResult = await supabase
    .from("member_invites")
    .insert({
      workspace_id: groupResult.data.workspace_id,
      group_id: groupId,
      invited_by_user_id: actorResult.data.id,
      invite_token: inviteToken,
      expires_at: expiresAt,
      is_active: true,
    })
    .select("id,invite_token,expires_at")
    .single();

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  const baseUrl = getAppBaseUrl(request);
  const inviteUrl = `${baseUrl.origin}/?invite=${insertResult.data.invite_token}`;

  return NextResponse.json({
    ok: true,
    inviteUrl,
    expiresAt: insertResult.data.expires_at,
  });
}

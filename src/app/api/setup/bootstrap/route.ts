import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    workspaceName?: string;
    groupName?: string;
    displayName?: string;
  };

  const workspaceName = body.workspaceName?.trim();
  const groupName = body.groupName?.trim();
  const displayName = body.displayName?.trim();

  if (!workspaceName || !groupName || !displayName) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { count } = await supabase
    .from("workspaces")
    .select("*", { count: "exact", head: true });

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "ALREADY_BOOTSTRAPPED" }, { status: 409 });
  }

  const allowedLineUserIds = (process.env.BOOTSTRAP_ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowedLineUserIds.includes(sessionUser.lineUserId)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const workspaceResult = await supabase
    .from("workspaces")
    .insert({ name: workspaceName })
    .select("id,name,timezone,notification_time")
    .single();

  if (workspaceResult.error) {
    return NextResponse.json({ error: workspaceResult.error.message }, { status: 500 });
  }

  const userResult = await supabase
    .from("app_users")
      .insert({
        line_user_id: sessionUser.lineUserId,
        display_name: displayName,
        line_picture_url: sessionUser.pictureUrl ?? null,
        role: "admin",
        is_active: true,
      })
    .select("id")
    .single();

  if (userResult.error) {
    return NextResponse.json({ error: userResult.error.message }, { status: 500 });
  }

  const userId = userResult.data.id;
  const workspaceId = workspaceResult.data.id;

  await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: userId,
    is_active: true,
  });

  const groupResult = await supabase
    .from("groups")
    .insert({
      workspace_id: workspaceId,
      name: groupName,
      is_active: true,
    })
    .select("id")
    .single();

  if (groupResult.error) {
    return NextResponse.json({ error: groupResult.error.message }, { status: 500 });
  }

  await supabase.from("group_members").insert({
    group_id: groupResult.data.id,
    user_id: userId,
    is_active: true,
  });

  return NextResponse.json({ ok: true });
}

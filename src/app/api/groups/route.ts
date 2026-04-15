import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string | null;
  };

  const name = body.name?.trim();
  const description = body.description?.trim() || null;

  if (!name) {
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

  const insertResult = await supabase
    .from("groups")
    .insert({
      workspace_id: workspaceMemberResult.data.workspace_id,
      name,
      description,
      is_active: true,
    })
    .select("id,workspace_id,name,description,is_active")
    .single();

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await supabase.from("group_members").upsert(
    {
      group_id: insertResult.data.id,
      user_id: actorResult.data.id,
      is_active: true,
      left_at: null,
    },
    { onConflict: "group_id,user_id" },
  );

  return NextResponse.json({ ok: true, group: insertResult.data });
}

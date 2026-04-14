import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    workspaceId?: string;
    title?: string;
    description?: string;
    priority?: "high" | "medium" | "low";
    scheduledDate?: string;
    scheduledTime?: string | null;
    visibilityType?: "group" | "personal";
    groupId?: string | null;
  };

  if (!body.workspaceId || !body.title || !body.scheduledDate || !body.visibilityType) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const actorUserId = actorResult.data.id;
  const insertResult = await supabase
    .from("tasks")
    .insert({
      workspace_id: body.workspaceId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      priority: body.priority ?? "medium",
      status: "pending",
      scheduled_date: body.scheduledDate,
      scheduled_time: body.scheduledTime || null,
      visibility_type: body.visibilityType,
      group_id: body.visibilityType === "group" ? body.groupId : null,
      owner_user_id: body.visibilityType === "personal" ? actorUserId : null,
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .select("*")
    .single();

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: insertResult.data.id,
    actor_user_id: actorUserId,
    action_type: "created",
    after_value: insertResult.data,
  });

  return NextResponse.json({ ok: true, task: insertResult.data });
}

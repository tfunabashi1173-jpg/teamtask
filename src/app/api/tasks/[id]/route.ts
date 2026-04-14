import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    priority?: "high" | "medium" | "low";
    scheduledDate?: string;
    scheduledTime?: string | null;
  };

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const beforeResult = await supabase.from("tasks").select("*").eq("id", id).single();
  if (beforeResult.error) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const updateResult = await supabase
    .from("tasks")
    .update({
      title: body.title?.trim() ?? beforeResult.data.title,
      description:
        body.description !== undefined ? body.description?.trim() || null : beforeResult.data.description,
      priority: body.priority ?? beforeResult.data.priority,
      scheduled_date: body.scheduledDate ?? beforeResult.data.scheduled_date,
      scheduled_time:
        body.scheduledTime !== undefined ? body.scheduledTime : beforeResult.data.scheduled_time,
      updated_by: actorResult.data.id,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    action_type: body.priority && body.priority !== beforeResult.data.priority ? "priority_changed" : "updated",
    before_value: beforeResult.data,
    after_value: updateResult.data,
  });

  return NextResponse.json({ ok: true, task: updateResult.data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const beforeResult = await supabase.from("tasks").select("*").eq("id", id).single();
  if (beforeResult.error) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  await supabase
    .from("tasks")
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: actorResult.data.id,
    })
    .eq("id", id);

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    action_type: "deleted",
    before_value: beforeResult.data,
  });

  return NextResponse.json({ ok: true });
}

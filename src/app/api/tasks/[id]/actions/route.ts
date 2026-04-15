import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sendTaskActionNotification } from "@/lib/notifications/web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type ActionType = "start" | "complete" | "pause" | "postpone";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const body = (await request.json()) as { action?: ActionType };

  if (!body.action) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id,display_name")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const beforeResult = await supabase.from("tasks").select("*").eq("id", id).single();
  if (beforeResult.error) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  if (
    body.action === "postpone" &&
    (beforeResult.data.priority === "urgent" || beforeResult.data.priority === "high")
  ) {
    return NextResponse.json({ error: "HIGH_PRIORITY_CANNOT_POSTPONE" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_by: actorResult.data.id,
  };

  let actionType = "status_changed";

  if (body.action === "start") {
    patch.status = "in_progress";
    patch.completed_at = null;
    actionType = "started";
  }

  if (body.action === "complete") {
    patch.status = "done";
    patch.completed_at = new Date().toISOString();
    actionType = "completed";
  }

  if (body.action === "pause") {
    patch.status = "pending";
    patch.completed_at = null;
    actionType = "status_changed";
  }

  if (body.action === "postpone") {
    const currentDate = new Date(`${beforeResult.data.scheduled_date}T00:00:00`);
    currentDate.setDate(currentDate.getDate() + 1);
    patch.scheduled_date = currentDate.toISOString().slice(0, 10);
    actionType = "postponed_to_next_day";
  }

  const updateResult = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    action_type: actionType,
    before_value: beforeResult.data,
    after_value: updateResult.data,
  });

  const actionLabel =
    body.action === "start"
      ? beforeResult.data.status === "done"
        ? "再開"
        : "開始"
      : body.action === "complete"
        ? "完了"
        : body.action === "pause"
          ? "中断"
          : "翌日に回す";

  await sendTaskActionNotification({
    workspaceId: beforeResult.data.workspace_id,
    actorUserId: actorResult.data.id,
    actorName: actorResult.data.display_name ?? "誰か",
    taskTitle: beforeResult.data.title,
    actionLabel,
    groupId: beforeResult.data.group_id,
    baseUrl: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ ok: true, task: updateResult.data });
}

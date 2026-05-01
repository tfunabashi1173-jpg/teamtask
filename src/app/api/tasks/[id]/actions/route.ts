import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getAppBaseUrl } from "@/lib/app-url";
import { sendTaskActionNotification } from "@/lib/notifications/web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type ActionType = "start" | "confirm" | "complete" | "pause" | "postpone";

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Date ? v.toISOString() : v)));
}

function nextDateStr(raw: unknown): string {
  let y: number, m: number, d: number;
  if (raw instanceof Date) {
    y = raw.getUTCFullYear();
    m = raw.getUTCMonth() + 1;
    d = raw.getUTCDate();
  } else {
    const parts = String(raw ?? "").slice(0, 10).split("-").map(Number);
    [y, m, d] = parts;
  }
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(request, context);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "UNHANDLED_ERROR", detail: message }, { status: 500 });
  }
}

async function handlePost(
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
  const [actorResult, beforeResult] = await Promise.all([
    supabase
      .from("app_users")
      .select("id,display_name")
      .eq("line_user_id", sessionUser.lineUserId)
      .single(),
    supabase.from("tasks").select("*").eq("id", id).single(),
  ]);

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

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
    patch.status = "awaiting_confirmation";
    patch.completed_at = null;
    actionType = "completed";
  }

  if (body.action === "confirm") {
    patch.status = "done";
    patch.completed_at = new Date().toISOString();
    actionType = "confirm_requested";
  }

  if (body.action === "pause") {
    patch.status = "pending";
    patch.completed_at = null;
    actionType = "status_changed";
  }

  if (body.action === "postpone") {
    patch.scheduled_date = nextDateStr(beforeResult.data.scheduled_date);
    actionType = "postponed_to_next_day";
  }

  const updateResult = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (updateResult.error) {
    return NextResponse.json(
      { error: updateResult.error.message, detail: updateResult.error.details ?? null },
      { status: 500 },
    );
  }

  try {
    await supabase.from("task_activity_logs").insert({
      task_id: id,
      actor_user_id: actorResult.data.id,
      actor_name: actorResult.data.display_name ?? null,
      action_type: actionType,
      before_value: toJsonSafe(beforeResult.data),
      after_value: toJsonSafe(updateResult.data),
    });
  } catch {
    // ログ記録失敗はタスク更新の成否に影響させない
  }

  const actionLabel =
    body.action === "start"
      ? beforeResult.data.status === "done"
        ? "再開"
        : "開始"
      : body.action === "confirm"
        ? "確認"
      : body.action === "complete"
        ? "完了"
      : body.action === "pause"
        ? "中断"
          : "翌日";

  try {
    await sendTaskActionNotification({
      workspaceId: beforeResult.data.workspace_id,
      actorUserId: actorResult.data.id,
      actorName: actorResult.data.display_name ?? "誰か",
      taskTitle: beforeResult.data.title,
      actionLabel,
      groupId: beforeResult.data.group_id,
      baseUrl: getAppBaseUrl(request).toString(),
    });
  } catch {
    // 通知失敗はタスク更新の成否に影響させない
  }

  return NextResponse.json({ ok: true, task: updateResult.data });
}

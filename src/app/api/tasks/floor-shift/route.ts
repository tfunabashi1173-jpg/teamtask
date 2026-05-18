import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { shiftFloorLevel } from "@/lib/tasks/floors";

export async function PATCH(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    workspaceId?: string;
    groupId?: string | null;
    scheduledDate?: string;
    direction?: "up" | "down";
  };

  if (!body.workspaceId || !body.groupId || !body.scheduledDate || !body.direction) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const delta = body.direction === "up" ? 1 : -1;
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

  const workspaceResult = await supabase
    .from("workspaces")
    .select("id,floor_range_start,floor_range_end")
    .eq("id", body.workspaceId)
    .single();

  if (workspaceResult.error) {
    return NextResponse.json({ error: "WORKSPACE_NOT_FOUND" }, { status: 404 });
  }

  const tasksResult = await supabase
    .from("tasks")
    .select("id,floor_level")
    .eq("workspace_id", body.workspaceId)
    .eq("group_id", body.groupId)
    .eq("scheduled_date", body.scheduledDate)
    .is("deleted_at", null);

  if (tasksResult.error) {
    return NextResponse.json({ error: tasksResult.error.message }, { status: 500 });
  }

  const taskRows =
    (((tasksResult.data as { id: string; floor_level: number | null }[] | null) ?? [])).filter(
      (task) => task.floor_level !== null,
    );

  if (taskRows.length === 0) {
    return NextResponse.json({ ok: true, updatedTaskIds: [] });
  }

  const taskIds = taskRows.map((task) => task.id);
  const sourceResult = await supabase
    .from("generated_task_sources")
    .select("task_id,recurrence_rule_id")
    .in("task_id", taskIds);

  if (sourceResult.error) {
    return NextResponse.json({ error: sourceResult.error.message }, { status: 500 });
  }

  const sourceRows =
    ((sourceResult.data as { task_id: string; recurrence_rule_id: string }[] | null) ?? []);
  const ruleIdByTaskId = new Map(sourceRows.map((row) => [row.task_id, row.recurrence_rule_id]));
  const directUpdates: { taskId: string; floorLevel: number }[] = [];
  const recurringUpdates = new Map<string, number>();

  taskRows.forEach((task) => {
    const nextFloor = shiftFloorLevel(
      task.floor_level,
      delta,
      workspaceResult.data.floor_range_start,
      workspaceResult.data.floor_range_end,
    );

    if (nextFloor === null || nextFloor === task.floor_level) {
      return;
    }

    const recurrenceRuleId = ruleIdByTaskId.get(task.id);
    if (recurrenceRuleId) {
      recurringUpdates.set(recurrenceRuleId, nextFloor);
      return;
    }

    directUpdates.push({ taskId: task.id, floorLevel: nextFloor });
  });

  const updatedTaskIds = new Set<string>();

  for (const updateRow of directUpdates) {
    const updateResult = await supabase
      .from("tasks")
      .update({ floor_level: updateRow.floorLevel, updated_by: actorResult.data.id })
      .eq("id", updateRow.taskId);

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
    }

    updatedTaskIds.add(updateRow.taskId);
  }

  for (const [recurrenceRuleId, floorLevel] of recurringUpdates.entries()) {
    const siblingSourceResult = await supabase
      .from("generated_task_sources")
      .select("task_id")
      .eq("recurrence_rule_id", recurrenceRuleId);

    if (siblingSourceResult.error) {
      return NextResponse.json({ error: siblingSourceResult.error.message }, { status: 500 });
    }

    const siblingTaskIds =
      ((siblingSourceResult.data as { task_id: string }[] | null) ?? []).map((row) => row.task_id);

    if (siblingTaskIds.length > 0) {
      const tasksUpdateResult = await supabase
        .from("tasks")
        .update({ floor_level: floorLevel, updated_by: actorResult.data.id })
        .in("id", siblingTaskIds)
        .is("deleted_at", null);

      if (tasksUpdateResult.error) {
        return NextResponse.json({ error: tasksUpdateResult.error.message }, { status: 500 });
      }

      siblingTaskIds.forEach((taskId) => updatedTaskIds.add(taskId));
    }

    const ruleUpdateResult = await supabase
      .from("recurrence_rules")
      .update({ floor_level: floorLevel, updated_by: actorResult.data.id })
      .eq("id", recurrenceRuleId);

    if (ruleUpdateResult.error) {
      return NextResponse.json({ error: ruleUpdateResult.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, updatedTaskIds: Array.from(updatedTaskIds) });
}

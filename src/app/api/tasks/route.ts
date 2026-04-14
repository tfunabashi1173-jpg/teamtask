import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  generateFutureOccurrenceDates,
  normalizeRecurrence,
  type RecurrenceFrequency,
} from "@/lib/tasks/recurrence";

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
    recurrence?: {
      enabled?: boolean;
      frequency?: RecurrenceFrequency;
      interval?: number;
      endDate?: string;
      daysOfWeek?: number[];
      dayOfMonth?: number | null;
    };
  };

  if (!body.workspaceId || !body.title || !body.scheduledDate || !body.visibilityType) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const trimmedTitle = body.title.trim();

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
      title: trimmedTitle,
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

  if (body.recurrence?.enabled) {
    if (!body.recurrence.frequency || !body.recurrence.endDate) {
      await supabase.from("tasks").delete().eq("id", insertResult.data.id);
      return NextResponse.json({ error: "INVALID_RECURRENCE" }, { status: 400 });
    }

    const recurrence = normalizeRecurrence({
      frequency: body.recurrence.frequency,
      interval: body.recurrence.interval ?? 1,
      startDate: body.scheduledDate,
      endDate: body.recurrence.endDate,
      daysOfWeek: body.recurrence.daysOfWeek,
      dayOfMonth: body.recurrence.dayOfMonth ?? null,
    });

    if (recurrence.endDate < recurrence.startDate) {
      await supabase.from("tasks").delete().eq("id", insertResult.data.id);
      return NextResponse.json({ error: "INVALID_RECURRENCE_PERIOD" }, { status: 400 });
    }

    const recurrenceResult = await supabase
      .from("recurrence_rules")
      .insert({
        workspace_id: body.workspaceId,
        visibility_type: body.visibilityType,
        group_id: body.visibilityType === "group" ? body.groupId : null,
        owner_user_id: body.visibilityType === "personal" ? actorUserId : null,
        title_template: trimmedTitle,
        description_template: body.description?.trim() || null,
        default_priority: body.priority ?? "medium",
        frequency: recurrence.frequency,
        interval_value: recurrence.interval,
        days_of_week: recurrence.daysOfWeek ?? null,
        day_of_month: recurrence.dayOfMonth ?? null,
        time_of_day: body.scheduledTime || null,
        start_date: recurrence.startDate,
        end_date: recurrence.endDate,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select("id")
      .single();

    if (recurrenceResult.error) {
      await supabase.from("tasks").delete().eq("id", insertResult.data.id);
      return NextResponse.json({ error: recurrenceResult.error.message }, { status: 500 });
    }

    const mappingResult = await supabase.from("generated_task_sources").insert({
      task_id: insertResult.data.id,
      recurrence_rule_id: recurrenceResult.data.id,
      generated_for_date: body.scheduledDate,
    });

    if (mappingResult.error) {
      await supabase.from("recurrence_rules").delete().eq("id", recurrenceResult.data.id);
      await supabase.from("tasks").delete().eq("id", insertResult.data.id);
      return NextResponse.json({ error: mappingResult.error.message }, { status: 500 });
    }

    const futureDates = generateFutureOccurrenceDates(recurrence);
    if (futureDates.length > 0) {
      const futureInsertResult = await supabase
        .from("tasks")
        .insert(
          futureDates.map((scheduledDate) => ({
            workspace_id: body.workspaceId,
            visibility_type: body.visibilityType,
            group_id: body.visibilityType === "group" ? body.groupId : null,
            owner_user_id: body.visibilityType === "personal" ? actorUserId : null,
            title: trimmedTitle,
            description: body.description?.trim() || null,
            priority: body.priority ?? "medium",
            status: "pending",
            scheduled_date: scheduledDate,
            scheduled_time: body.scheduledTime || null,
            created_by: actorUserId,
            updated_by: actorUserId,
          })),
        )
        .select("id,scheduled_date");

      if (futureInsertResult.error) {
        await supabase.from("generated_task_sources").delete().eq("recurrence_rule_id", recurrenceResult.data.id);
        await supabase.from("recurrence_rules").delete().eq("id", recurrenceResult.data.id);
        await supabase.from("tasks").delete().eq("id", insertResult.data.id);
        return NextResponse.json({ error: futureInsertResult.error.message }, { status: 500 });
      }

      const sourceInsertResult = await supabase.from("generated_task_sources").insert(
        (futureInsertResult.data ?? []).map((task) => ({
          task_id: task.id,
          recurrence_rule_id: recurrenceResult.data.id,
          generated_for_date: task.scheduled_date,
        })),
      );

      if (sourceInsertResult.error) {
        await supabase.from("generated_task_sources").delete().eq("recurrence_rule_id", recurrenceResult.data.id);
        await supabase.from("recurrence_rules").delete().eq("id", recurrenceResult.data.id);
        await supabase.from("tasks").delete().eq("id", insertResult.data.id);
        return NextResponse.json({ error: sourceInsertResult.error.message }, { status: 500 });
      }
    }
  }

  await supabase.from("task_activity_logs").insert({
    task_id: insertResult.data.id,
    actor_user_id: actorUserId,
    action_type: "created",
    after_value: insertResult.data,
  });

  return NextResponse.json({ ok: true, task: insertResult.data });
}

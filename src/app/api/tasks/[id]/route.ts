import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  generateFutureOccurrenceDates,
  normalizeRecurrence,
  type RecurrenceFrequency,
} from "@/lib/tasks/recurrence";

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
    priority?: "urgent" | "high" | "medium" | "low";
    scheduledDate?: string;
    scheduledTime?: string | null;
    updateScope?: "single" | "all";
    recurrence?: {
      enabled?: boolean;
      frequency?: RecurrenceFrequency;
      interval?: number;
      endDate?: string;
      daysOfWeek?: number[];
      dayOfMonth?: number | null;
    };
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

  const currentSourceResult = await supabase
    .from("generated_task_sources")
    .select("recurrence_rule_id")
    .eq("task_id", id)
    .maybeSingle();

  const currentRecurrenceRuleId = currentSourceResult.data?.recurrence_rule_id ?? null;

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

  const updatedTask = updateResult.data;

  // Bulk update: sync content to all sibling tasks from the same recurrence rule
  if (body.updateScope === "all" && currentRecurrenceRuleId) {
    const siblingResult = await supabase
      .from("generated_task_sources")
      .select("task_id")
      .eq("recurrence_rule_id", currentRecurrenceRuleId)
      .neq("task_id", id);

    const siblingIds = ((siblingResult.data as { task_id: string }[] | null) ?? []).map((r) => r.task_id);

    if (siblingIds.length > 0) {
      await supabase
        .from("tasks")
        .update({
          title: updatedTask.title,
          description: updatedTask.description,
          priority: updatedTask.priority,
          scheduled_time: updatedTask.scheduled_time,
          updated_by: actorResult.data.id,
        })
        .in("id", siblingIds)
        .is("deleted_at", null);
    }

    await supabase
      .from("recurrence_rules")
      .update({
        title_template: updatedTask.title,
        description_template: updatedTask.description,
        default_priority: updatedTask.priority,
        time_of_day: updatedTask.scheduled_time,
        updated_by: actorResult.data.id,
      })
      .eq("id", currentRecurrenceRuleId);
  }

  if (body.recurrence?.enabled) {
    if (!body.recurrence.frequency || !body.recurrence.endDate) {
      return NextResponse.json({ error: "INVALID_RECURRENCE" }, { status: 400 });
    }

    const recurrence = normalizeRecurrence({
      frequency: body.recurrence.frequency,
      interval: body.recurrence.interval ?? 1,
      startDate: updatedTask.scheduled_date,
      endDate: body.recurrence.endDate,
      daysOfWeek: body.recurrence.daysOfWeek,
      dayOfMonth: body.recurrence.dayOfMonth ?? null,
    });

    if (recurrence.endDate < recurrence.startDate) {
      return NextResponse.json({ error: "INVALID_RECURRENCE_PERIOD" }, { status: 400 });
    }

    const rulePayload = {
      title_template: updatedTask.title,
      description_template: updatedTask.description,
      default_priority: updatedTask.priority,
      frequency: recurrence.frequency,
      interval_value: recurrence.interval,
      days_of_week: recurrence.daysOfWeek ?? null,
      day_of_month: recurrence.dayOfMonth ?? null,
      time_of_day: updatedTask.scheduled_time,
      start_date: recurrence.startDate,
      end_date: recurrence.endDate,
      is_active: true,
      updated_by: actorResult.data.id,
    };

    let recurrenceRuleId = currentRecurrenceRuleId;

    if (recurrenceRuleId) {
      const ruleUpdateResult = await supabase
        .from("recurrence_rules")
        .update(rulePayload)
        .eq("id", recurrenceRuleId);

      if (ruleUpdateResult.error) {
        return NextResponse.json({ error: ruleUpdateResult.error.message }, { status: 500 });
      }

      await supabase
        .from("generated_task_sources")
        .update({ generated_for_date: updatedTask.scheduled_date })
        .eq("task_id", id);
    } else {
      const ruleCreateResult = await supabase
        .from("recurrence_rules")
        .insert({
          workspace_id: beforeResult.data.workspace_id,
          visibility_type: beforeResult.data.visibility_type,
          group_id: beforeResult.data.group_id,
          owner_user_id: beforeResult.data.owner_user_id,
          created_by: actorResult.data.id,
          ...rulePayload,
        })
        .select("id")
        .single();

      if (ruleCreateResult.error) {
        return NextResponse.json({ error: ruleCreateResult.error.message }, { status: 500 });
      }

      recurrenceRuleId = ruleCreateResult.data.id;

      const mappingInsertResult = await supabase.from("generated_task_sources").insert({
        task_id: id,
        recurrence_rule_id: recurrenceRuleId,
        generated_for_date: updatedTask.scheduled_date,
      });

      if (mappingInsertResult.error) {
        return NextResponse.json({ error: mappingInsertResult.error.message }, { status: 500 });
      }
    }

    const generatedRowsResult = await supabase
      .from("generated_task_sources")
      .select("task_id")
      .eq("recurrence_rule_id", recurrenceRuleId)
      .neq("task_id", id);

    const generatedTaskIds =
      ((generatedRowsResult.data as { task_id: string }[] | null) ?? []).map((row) => row.task_id);

    if (generatedTaskIds.length > 0) {
      await supabase
        .from("tasks")
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: actorResult.data.id,
        })
        .in("id", generatedTaskIds);

      await supabase.from("generated_task_sources").delete().in("task_id", generatedTaskIds);
    }

    const futureDates = generateFutureOccurrenceDates(recurrence);

    if (futureDates.length > 0) {
      const futureInsertResult = await supabase
        .from("tasks")
        .insert(
          futureDates.map((scheduledDate) => ({
            workspace_id: updatedTask.workspace_id,
            visibility_type: updatedTask.visibility_type,
            group_id: updatedTask.group_id,
            owner_user_id: updatedTask.owner_user_id,
            title: updatedTask.title,
            description: updatedTask.description,
            priority: updatedTask.priority,
            status: "pending",
            scheduled_date: scheduledDate,
            scheduled_time: updatedTask.scheduled_time,
            created_by: actorResult.data.id,
            updated_by: actorResult.data.id,
          })),
        )
        .select("id,scheduled_date");

      if (futureInsertResult.error) {
        return NextResponse.json({ error: futureInsertResult.error.message }, { status: 500 });
      }

      const sourceInsertResult = await supabase.from("generated_task_sources").insert(
        (futureInsertResult.data ?? []).map((task) => ({
          task_id: task.id,
          recurrence_rule_id: recurrenceRuleId,
          generated_for_date: task.scheduled_date,
        })),
      );

      if (sourceInsertResult.error) {
        return NextResponse.json({ error: sourceInsertResult.error.message }, { status: 500 });
      }
    }
  } else if (currentRecurrenceRuleId) {
    const generatedRowsResult = await supabase
      .from("generated_task_sources")
      .select("task_id")
      .eq("recurrence_rule_id", currentRecurrenceRuleId)
      .neq("task_id", id);

    const generatedTaskIds =
      ((generatedRowsResult.data as { task_id: string }[] | null) ?? []).map((row) => row.task_id);

    if (generatedTaskIds.length > 0) {
      await supabase
        .from("tasks")
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: actorResult.data.id,
        })
        .in("id", generatedTaskIds);

      await supabase.from("generated_task_sources").delete().in("task_id", generatedTaskIds);
    }

    await supabase.from("generated_task_sources").delete().eq("task_id", id);
    await supabase
      .from("recurrence_rules")
      .update({ is_active: false, updated_by: actorResult.data.id })
      .eq("id", currentRecurrenceRuleId);
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

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sendUrgentTaskCreatedNotification } from "@/lib/notifications/web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  generateFutureOccurrenceDates,
  normalizeRecurrence,
  startDateMatchesWeeklyRule,
  titleSimilarity,
  type RecurrenceFrequency,
} from "@/lib/tasks/recurrence";

const RECURRENCE_DUPLICATE_SIMILARITY_THRESHOLD = 0.75;

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    workspaceId?: string;
    title?: string;
    description?: string;
    priority?: "urgent" | "high" | "medium" | "low";
    scheduledDate?: string;
    scheduledTime?: string | null;
    visibilityType?: "group" | "personal";
    groupId?: string | null;
    force?: boolean; // ユーザーが重複警告を無視して登録する場合 true
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

  let siblingTaskIds: string[] = [];
  let startMatches = true;

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

    // ── 重複チェック ──────────────────────────────────────────────
    // force=true の場合はユーザーが確認済みのためスキップ
    // 同グループ・日付範囲が重なる既存ルールを取得し、タイトル類似度で判定
    if (!body.force) {
      const existingRulesResult = await supabase
        .from("recurrence_rules")
        .select("id,title_template,start_date,end_date")
        .eq("workspace_id", body.workspaceId)
        .eq("group_id", body.visibilityType === "group" ? (body.groupId ?? "") : "")
        .lte("start_date", body.recurrence.endDate)  // 既存の開始日 ≤ 新しい終了日
        .gte("end_date", body.scheduledDate);         // 既存の終了日 ≥ 新しい開始日

      if (!existingRulesResult.error && existingRulesResult.data) {
        const similar = existingRulesResult.data.find(
          (rule) => titleSimilarity(rule.title_template as string, trimmedTitle) >= RECURRENCE_DUPLICATE_SIMILARITY_THRESHOLD,
        );
        if (similar) {
          await supabase.from("tasks").delete().eq("id", insertResult.data.id);
          return NextResponse.json(
            {
              error: "DUPLICATE_RECURRENCE",
              similarTitle: similar.title_template,
              similarity: Math.round(titleSimilarity(similar.title_template as string, trimmedTitle) * 100),
            },
            { status: 409 },
          );
        }
      }
    }
    // ─────────────────────────────────────────────────────────────

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

    // If start date doesn't match the weekly rule, delete the initial task —
    // all occurrences will be generated by generateFutureOccurrenceDates below.
    startMatches = startDateMatchesWeeklyRule(recurrence);
    if (!startMatches) {
      await supabase.from("tasks").delete().eq("id", insertResult.data.id);
    } else {
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
    }

    // generateFutureOccurrenceDates now starts from startDate (inclusive for weekly).
    // Skip the start date in the generated list if a task was already created for it.
    const allDates = generateFutureOccurrenceDates(recurrence);
    const futureDates = startMatches ? allDates.filter((d) => d !== body.scheduledDate) : allDates;

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
        if (startMatches) await supabase.from("tasks").delete().eq("id", insertResult.data.id);
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

      siblingTaskIds = (futureInsertResult.data ?? []).map((t) => t.id);
    }
  }

  const representativeTaskId = startMatches ? insertResult.data.id : siblingTaskIds[0] ?? insertResult.data.id;

  await supabase.from("task_activity_logs").insert({
    task_id: representativeTaskId,
    actor_user_id: actorUserId,
    actor_name: sessionUser.displayName ?? null,
    action_type: "created",
    after_value: insertResult.data,
  });

  if ((body.priority ?? "medium") === "urgent") {
    await sendUrgentTaskCreatedNotification({
      workspaceId: body.workspaceId,
      actorUserId,
      actorName: sessionUser.displayName ?? "誰か",
      taskTitle: trimmedTitle,
      groupId: body.visibilityType === "group" ? body.groupId ?? null : null,
      includeActor: true,
      baseUrl: new URL("/", request.url).toString(),
    });
  }

  return NextResponse.json({ ok: true, task: startMatches ? insertResult.data : null, siblingTaskIds });
}

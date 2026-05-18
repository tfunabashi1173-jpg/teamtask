import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_FLOOR_RANGE_END,
  DEFAULT_FLOOR_RANGE_START,
  normalizeFloorRange,
  parseFloorLevel,
} from "@/lib/tasks/floors";

export async function PATCH(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    notificationTime?: string;
    notificationTime2?: string | null;
    floorRangeStart?: number | string | null;
    floorRangeEnd?: number | string | null;
  };
  const notificationTime = body.notificationTime?.slice(0, 5);

  if (!notificationTime || !/^\d{2}:\d{2}$/.test(notificationTime)) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const notificationTime2Raw = body.notificationTime2;
  const notificationTime2 =
    notificationTime2Raw && /^\d{2}:\d{2}$/.test(notificationTime2Raw.slice(0, 5))
      ? notificationTime2Raw.slice(0, 5)
      : null;
  const normalizedFloorRange = normalizeFloorRange(
    parseFloorLevel(body.floorRangeStart) ?? DEFAULT_FLOOR_RANGE_START,
    parseFloorLevel(body.floorRangeEnd) ?? DEFAULT_FLOOR_RANGE_END,
  );

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

  const updateResult = await supabase
    .from("workspaces")
    .update({
      notification_time: notificationTime,
      notification_time_2: notificationTime2,
      floor_range_start: normalizedFloorRange.start,
      floor_range_end: normalizedFloorRange.end,
    })
    .eq("id", workspaceMemberResult.data.workspace_id)
    .select("id,name,timezone,notification_time,notification_time_2,floor_range_start,floor_range_end")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, workspace: updateResult.data });
}

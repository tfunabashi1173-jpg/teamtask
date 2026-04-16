import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendEveningTaskNotifications } from "@/lib/notifications/web-push";

// Workflow runs every 10min; window covers interval + 2min drift tolerance
const EVENING_NOTIFICATION_WINDOW_MINUTES = 12;

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function getWorkspaceLocalParts(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function parseDueMinutes(notificationTime: string) {
  const [hourText, minuteText] = notificationTime.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const workspacesResult = await supabase
    .from("workspaces")
    .select("id,name,timezone,notification_time_2")
    .not("notification_time_2", "is", null);

  const workspaces =
    (workspacesResult.data as
      | { id: string; name: string; timezone: string; notification_time_2: string }[]
      | null) ?? [];
  const baseUrl = new URL("/", request.url).toString();
  const now = new Date();

  const results = await Promise.all(
    workspaces.map(async (workspace) => {
      const timezone = workspace.timezone || "Asia/Tokyo";
      const localNow = getWorkspaceLocalParts(now, timezone);
      const currentMinutes = localNow.hour * 60 + localNow.minute;
      const dueTime = workspace.notification_time_2.slice(0, 5);
      const dueMinutes = parseDueMinutes(dueTime);

      if (dueMinutes === null) {
        return { workspaceId: workspace.id, skipped: true, sent: 0, reason: "invalid_time" };
      }

      const minutesSinceDue = currentMinutes - dueMinutes;
      if (minutesSinceDue < 0 || minutesSinceDue >= EVENING_NOTIFICATION_WINDOW_MINUTES) {
        return {
          workspaceId: workspace.id,
          skipped: true,
          sent: 0,
          reason: "out_of_window",
          currentTime: `${String(localNow.hour).padStart(2, "0")}:${String(localNow.minute).padStart(2, "0")}`,
          dueTime,
        };
      }

      return {
        workspaceId: workspace.id,
        skipped: false,
        ...(await sendEveningTaskNotifications({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          baseUrl,
          targetDate: localNow.date,
        })),
      };
    }),
  );

  return NextResponse.json({ ok: true, results });
}

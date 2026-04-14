import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendMorningTaskNotifications } from "@/lib/notifications/web-push";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const workspacesResult = await supabase
    .from("workspaces")
    .select("id,name,timezone,notification_time");

  const workspaces =
    (workspacesResult.data as
      | { id: string; name: string; timezone: string; notification_time: string }[]
      | null) ?? [];
  const baseUrl = new URL("/", request.url).toString();
  const now = new Date();

  const results = await Promise.all(
    workspaces.map(async (workspace) => {
      const currentTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: workspace.timezone || "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);

      const dueTime = (workspace.notification_time ?? "08:00").slice(0, 5);
      if (currentTime !== dueTime) {
        return { workspaceId: workspace.id, skipped: true, sent: 0 };
      }

      return {
        workspaceId: workspace.id,
        skipped: false,
        ...(await sendMorningTaskNotifications({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          baseUrl,
        })),
      };
    }),
  );

  return NextResponse.json({ ok: true, results });
}

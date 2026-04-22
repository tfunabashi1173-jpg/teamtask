import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { purgeExpiredCompletedTasks, purgeExpiredTaskLogs } from "@/lib/tasks/cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id");

  const workspaceIds = (workspaces ?? []).map((w: { id: string }) => w.id);

  await Promise.all(workspaceIds.map((id: string) => purgeExpiredCompletedTasks(id)));
  await purgeExpiredTaskLogs();

  return NextResponse.json({ ok: true, workspaces: workspaceIds.length });
}

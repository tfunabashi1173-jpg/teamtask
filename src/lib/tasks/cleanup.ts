import { createSupabaseAdminClient } from "@/lib/supabase/server";

const TASK_ACTIVITY_LOG_RETENTION_DAYS = 7;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function purgeExpiredCompletedTasks(workspaceId: string) {
  void workspaceId;
  return { deletedTasks: 0 };
}

export async function purgeExpiredTaskLogs() {
  const supabase = createSupabaseAdminClient();
  const cutoff = isoDaysAgo(TASK_ACTIVITY_LOG_RETENTION_DAYS);

  const staleLogsResult = await supabase
    .from("task_activity_logs")
    .select("id")
    .lt("created_at", cutoff);

  if (staleLogsResult.error) {
    throw new Error(`Failed to load stale task logs: ${staleLogsResult.error.message}`);
  }

  const staleLogIds = ((staleLogsResult.data as { id: string }[] | null) ?? []).map((row) => row.id);

  if (staleLogIds.length === 0) {
    return { deletedLogs: 0, deletedDismissals: 0 };
  }

  const dismissalsResult = await supabase
    .from("task_log_dismissals")
    .delete()
    .in("log_id", staleLogIds)
    .select("log_id");

  if (dismissalsResult.error) {
    throw new Error(`Failed to purge task log dismissals: ${dismissalsResult.error.message}`);
  }

  const logsResult = await supabase
    .from("task_activity_logs")
    .delete()
    .in("id", staleLogIds)
    .select("id");

  if (logsResult.error) {
    throw new Error(`Failed to purge task activity logs: ${logsResult.error.message}`);
  }

  return {
    deletedLogs: ((logsResult.data as { id: string }[] | null) ?? []).length,
    deletedDismissals: ((dismissalsResult.data as { log_id: string }[] | null) ?? []).length,
  };
}

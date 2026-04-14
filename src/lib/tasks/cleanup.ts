import { createSupabaseAdminClient } from "@/lib/supabase/server";

const COMPLETED_TASK_RETENTION_DAYS = 7;

function getTaskPhotoBucketName() {
  return process.env.SUPABASE_TASK_PHOTO_BUCKET || "task-photos";
}

export async function purgeExpiredCompletedTasks(workspaceId: string) {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - COMPLETED_TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const expiredTasksResult = await supabase
    .from("tasks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "done")
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .lt("completed_at", cutoff);

  if (expiredTasksResult.error || !expiredTasksResult.data?.length) {
    return;
  }

  const taskIds = expiredTasksResult.data.map((task) => task.id);

  const photosResult = await supabase
    .from("task_photos")
    .select("storage_path")
    .in("task_id", taskIds);

  const photoPaths =
    ((photosResult.data as { storage_path: string }[] | null) ?? [])
      .map((photo) => photo.storage_path)
      .filter(Boolean);

  if (photoPaths.length > 0) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove(photoPaths);
  }

  await supabase.from("tasks").delete().in("id", taskIds);
}

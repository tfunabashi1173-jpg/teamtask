export function getTaskPhotoBucketName() {
  return process.env.SUPABASE_TASK_PHOTO_BUCKET || "task-photos";
}

export function buildTaskPhotoPath(taskId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${taskId}/${Date.now()}-${safeName}`;
}

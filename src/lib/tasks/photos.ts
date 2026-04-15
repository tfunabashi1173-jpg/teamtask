export function getTaskPhotoBucketName() {
  return process.env.SUPABASE_TASK_PHOTO_BUCKET || "task-photos";
}

export function buildTaskAssetPath(taskId: string, kind: "completion" | "reference", fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${kind}/${taskId}/${Date.now()}-${safeName}`;
}

export function buildTaskPhotoPath(taskId: string, fileName: string) {
  return buildTaskAssetPath(taskId, "completion", fileName);
}

export function buildTaskReferencePhotoPath(taskId: string, fileName: string) {
  return buildTaskAssetPath(taskId, "reference", fileName);
}

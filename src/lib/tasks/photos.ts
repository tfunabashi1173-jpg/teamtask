export function getTaskPhotoBucketName() {
  return process.env.SUPABASE_TASK_PHOTO_BUCKET || "task-photos";
}

export function buildTaskAssetPath(taskId: string, kind: "completion" | "reference", fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Date.now() alone causes path collisions on parallel uploads (same ms).
  // Add a random suffix to guarantee uniqueness even for same-named files.
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${kind}/${taskId}/${uid}-${safeName}`;
}

export function buildTaskPhotoPath(taskId: string, fileName: string) {
  return buildTaskAssetPath(taskId, "completion", fileName);
}

export function buildTaskReferencePhotoPath(taskId: string, fileName: string) {
  return buildTaskAssetPath(taskId, "reference", fileName);
}

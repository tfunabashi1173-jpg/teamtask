import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  buildTaskPhotoPath,
  buildTaskThumbnailPath,
  createTaskThumbnailBuffer,
  getTaskPhotoBucketName,
} from "@/lib/tasks/photos";

const MAX_TASK_PHOTOS = 3;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "INVALID_FILE" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json(
      {
        error: "ACTOR_NOT_FOUND",
        stage: "precheck_actor",
        detail: actorResult.error.message,
      },
      { status: 404 },
    );
  }

  const taskResult = await supabase.from("tasks").select("*").eq("id", id).single();
  if (taskResult.error) {
    return NextResponse.json(
      {
        error: "TASK_NOT_FOUND",
        stage: "precheck_task",
        detail: taskResult.error.message,
      },
      { status: 404 },
    );
  }

  if (taskResult.data.status !== "done" && taskResult.data.status !== "awaiting_confirmation") {
    return NextResponse.json({ error: "TASK_NOT_COMPLETED" }, { status: 400 });
  }

  const currentPhotoResult = await supabase
    .from("task_photos")
    .select("id")
    .eq("task_id", id);

  const currentCount = currentPhotoResult.data?.length ?? 0;
  if (currentCount >= MAX_TASK_PHOTOS) {
    return NextResponse.json({ error: "PHOTO_LIMIT_REACHED", stage: "precheck_limit" }, { status: 400 });
  }

  const storagePath = buildTaskPhotoPath(id, file.name || "photo.jpg");
  const thumbnailStoragePath = buildTaskThumbnailPath(storagePath);
  const uploadResultPromise = supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });
  const thumbnailBufferPromise = file.arrayBuffer().then((buffer) => createTaskThumbnailBuffer(buffer));
  const [uploadResultSettled, thumbnailBufferSettled] = await Promise.allSettled([
    uploadResultPromise,
    thumbnailBufferPromise,
  ]);

  if (uploadResultSettled.status === "rejected") {
    return NextResponse.json(
      {
        error: uploadResultSettled.reason instanceof Error ? uploadResultSettled.reason.message : "STORAGE_UPLOAD_FAILED",
        stage: "storage_upload",
      },
      { status: 500 },
    );
  }

  const uploadResult = uploadResultSettled.value;

  if (thumbnailBufferSettled.status === "rejected") {
    if (!uploadResult.error) {
      await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath]);
    }
    return NextResponse.json(
      {
        error:
          thumbnailBufferSettled.reason instanceof Error
            ? thumbnailBufferSettled.reason.message
            : "THUMBNAIL_GENERATION_FAILED",
        stage: "thumbnail_generation",
      },
      { status: 500 },
    );
  }

  const thumbnailBuffer = thumbnailBufferSettled.value;

  if (uploadResult.error) {
    return NextResponse.json(
      {
        error: uploadResult.error.message,
        stage: "storage_upload",
      },
      { status: 500 },
    );
  }

  const thumbnailUploadResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(thumbnailStoragePath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (thumbnailUploadResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath]);
    return NextResponse.json(
      {
        error: thumbnailUploadResult.error.message,
        stage: "storage_upload_thumbnail",
      },
      { status: 500 },
    );
  }

  const insertResult = await supabase
    .from("task_photos")
    .insert({
      task_id: id,
      storage_path: storagePath,
      thumbnail_storage_path: thumbnailStoragePath,
      file_name: file.name || "photo.jpg",
      mime_type: file.type,
      uploaded_by: actorResult.data.id,
    })
    .select("id,task_id,file_name,mime_type,storage_path,thumbnail_storage_path,created_at")
    .single();

  if (insertResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath, thumbnailStoragePath]);
    return NextResponse.json(
      {
        error: insertResult.error.message,
        stage: "db_insert_task_photos",
        },
      { status: 500 },
    );
  }

  const logInsertResult = await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    actor_name: sessionUser.displayName ?? null,
    action_type: "photo_added",
    after_value: insertResult.data,
  });

  if (logInsertResult.error) {
    console.error("[teamtask] photo upload log insert failed", {
      stage: "db_insert_task_activity_logs",
      message: logInsertResult.error.message,
      detail: logInsertResult.error.details,
      code: logInsertResult.error.code,
      taskId: id,
    });
  }

  return NextResponse.json({
    ok: true,
    photo: {
      ...insertResult.data,
      preview_url: `/api/task-photos/${insertResult.data.id}`,
    },
  });
}

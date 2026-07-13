import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  buildTaskReferencePhotoPath,
  buildTaskThumbnailPath,
  createTaskThumbnailBuffer,
  getTaskPhotoBucketName,
} from "@/lib/tasks/photos";

const MAX_REFERENCE_PHOTOS = 5;

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
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const taskResult = await supabase.from("tasks").select("id").eq("id", id).single();
  if (taskResult.error) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const currentPhotoResult = await supabase
    .from("task_reference_photos")
    .select("id")
    .eq("task_id", id);

  const currentCount = currentPhotoResult.data?.length ?? 0;
  if (currentCount >= MAX_REFERENCE_PHOTOS) {
    return NextResponse.json({ error: "PHOTO_LIMIT_REACHED" }, { status: 400 });
  }

  const storagePath = buildTaskReferencePhotoPath(id, file.name || "reference.jpg");
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
    return NextResponse.json({ error: uploadResult.error.message }, { status: 500 });
  }

  const thumbnailUploadResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(thumbnailStoragePath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (thumbnailUploadResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath]);
    return NextResponse.json({ error: thumbnailUploadResult.error.message }, { status: 500 });
  }

  const insertResult = await supabase
    .from("task_reference_photos")
    .insert({
      task_id: id,
      storage_path: storagePath,
      thumbnail_storage_path: thumbnailStoragePath,
      file_name: file.name || "reference.jpg",
      mime_type: file.type,
      uploaded_by: actorResult.data.id,
    })
    .select("id,task_id,file_name,mime_type,storage_path,thumbnail_storage_path,created_at")
    .single();

  if (insertResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath, thumbnailStoragePath]);
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    actor_name: sessionUser.displayName ?? null,
    action_type: "photo_added",
    after_value: insertResult.data,
  });

  return NextResponse.json({
    ok: true,
    photo: {
      ...insertResult.data,
      preview_url: `/api/task-reference-photos/${insertResult.data.id}`,
    },
  });
}

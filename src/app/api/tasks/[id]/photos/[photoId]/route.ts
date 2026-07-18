import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  buildTaskPhotoPath,
  buildTaskThumbnailPath,
  createTaskThumbnailBuffer,
  getTaskPhotoBucketName,
} from "@/lib/tasks/photos";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; photoId: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id, photoId } = await context.params;
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

  const photoResult = await supabase
    .from("task_photos")
    .select("id,task_id,storage_path,thumbnail_storage_path,file_name,mime_type,created_at")
    .eq("id", photoId)
    .eq("task_id", id)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const nextStoragePath = buildTaskPhotoPath(id, file.name || "photo.jpg");
  const nextThumbnailStoragePath = buildTaskThumbnailPath(nextStoragePath);
  const uploadResultPromise = supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(nextStoragePath, file, {
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
      await supabase.storage.from(getTaskPhotoBucketName()).remove([nextStoragePath]);
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
    .upload(nextThumbnailStoragePath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (thumbnailUploadResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([nextStoragePath]);
    return NextResponse.json({ error: thumbnailUploadResult.error.message }, { status: 500 });
  }

  const updateResult = await supabase
    .from("task_photos")
    .update({
      storage_path: nextStoragePath,
      thumbnail_storage_path: nextThumbnailStoragePath,
      file_name: file.name || "photo.jpg",
      mime_type: file.type,
    })
    .eq("id", photoId)
    .select("id,task_id,file_name,mime_type,storage_path,thumbnail_storage_path,created_at")
    .single();

  if (updateResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([nextStoragePath, nextThumbnailStoragePath]);
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  await supabase.storage
    .from(getTaskPhotoBucketName())
    .remove(
      [
        photoResult.data.storage_path,
        photoResult.data.thumbnail_storage_path,
      ].filter((path): path is string => Boolean(path)),
    );

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    actor_name: sessionUser.displayName ?? null,
    action_type: "photo_updated",
    before_value: photoResult.data,
    after_value: updateResult.data,
  });

  return NextResponse.json({
    ok: true,
    photo: {
      ...updateResult.data,
      preview_url: `/api/task-photos/${updateResult.data.id}`,
      thumbnail_url: `/api/task-photos/${updateResult.data.id}?thumb=1&v=${encodeURIComponent(nextThumbnailStoragePath)}`,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; photoId: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id, photoId } = await context.params;
  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const photoResult = await supabase
    .from("task_photos")
    .select("id,task_id,storage_path,thumbnail_storage_path,file_name,mime_type,created_at")
    .eq("id", photoId)
    .eq("task_id", id)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  await supabase.storage
    .from(getTaskPhotoBucketName())
    .remove(
      [
        photoResult.data.storage_path,
        photoResult.data.thumbnail_storage_path,
      ].filter((path): path is string => Boolean(path)),
    );

  const deleteResult = await supabase.from("task_photos").delete().eq("id", photoId);
  if (deleteResult.error) {
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    actor_name: sessionUser.displayName ?? null,
    action_type: "photo_deleted",
    before_value: photoResult.data,
  });

  return NextResponse.json({ ok: true, photoId });
}

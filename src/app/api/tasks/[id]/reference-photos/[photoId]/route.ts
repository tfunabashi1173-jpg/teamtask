import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { buildTaskReferencePhotoPath, getTaskPhotoBucketName } from "@/lib/tasks/photos";

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
    .from("task_reference_photos")
    .select("id,task_id,storage_path,file_name,mime_type,created_at")
    .eq("id", photoId)
    .eq("task_id", id)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const nextStoragePath = buildTaskReferencePhotoPath(id, file.name || "reference.jpg");
  const uploadResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(nextStoragePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadResult.error) {
    return NextResponse.json({ error: uploadResult.error.message }, { status: 500 });
  }

  const updateResult = await supabase
    .from("task_reference_photos")
    .update({
      storage_path: nextStoragePath,
      file_name: file.name || "reference.jpg",
      mime_type: file.type,
    })
    .eq("id", photoId)
    .select("id,task_id,file_name,mime_type,storage_path,created_at")
    .single();

  if (updateResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([nextStoragePath]);
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  // Only remove old file from storage if no other task references it
  const remainingOldResult = await supabase
    .from("task_reference_photos")
    .select("id")
    .eq("storage_path", photoResult.data.storage_path);
  if ((remainingOldResult.data?.length ?? 0) === 0) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([photoResult.data.storage_path]);
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    action_type: "photo_updated",
    before_value: photoResult.data,
    after_value: updateResult.data,
  });

  return NextResponse.json({
    ok: true,
    photo: {
      ...updateResult.data,
      preview_url: `/api/task-reference-photos/${updateResult.data.id}`,
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
    .from("task_reference_photos")
    .select("id,task_id,storage_path,file_name,mime_type,created_at")
    .eq("id", photoId)
    .eq("task_id", id)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const deleteResult = await supabase.from("task_reference_photos").delete().eq("id", photoId);
  if (deleteResult.error) {
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  // Only remove from storage if no other task references the same file
  const remainingResult = await supabase
    .from("task_reference_photos")
    .select("id")
    .eq("storage_path", photoResult.data.storage_path);
  if ((remainingResult.data?.length ?? 0) === 0) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([photoResult.data.storage_path]);
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
    action_type: "photo_deleted",
    before_value: photoResult.data,
  });

  return NextResponse.json({ ok: true, photoId });
}

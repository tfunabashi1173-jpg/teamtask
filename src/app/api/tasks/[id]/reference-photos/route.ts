import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { buildTaskReferencePhotoPath, getTaskPhotoBucketName } from "@/lib/tasks/photos";

const MAX_REFERENCE_PHOTOS = 2;

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
  const uploadResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadResult.error) {
    return NextResponse.json({ error: uploadResult.error.message }, { status: 500 });
  }

  const insertResult = await supabase
    .from("task_reference_photos")
    .insert({
      task_id: id,
      storage_path: storagePath,
      file_name: file.name || "reference.jpg",
      mime_type: file.type,
      uploaded_by: actorResult.data.id,
    })
    .select("id,task_id,file_name,mime_type,storage_path,created_at")
    .single();

  if (insertResult.error) {
    await supabase.storage.from(getTaskPhotoBucketName()).remove([storagePath]);
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await supabase.from("task_activity_logs").insert({
    task_id: id,
    actor_user_id: actorResult.data.id,
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

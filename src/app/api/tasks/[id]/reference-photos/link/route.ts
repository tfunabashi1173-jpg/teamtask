import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const MAX_REFERENCE_PHOTOS = 2;

// Creates a task_reference_photos record pointing to an existing storage file.
// Used to share one uploaded image across all recurring task instances.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { id } = await context.params;
  const body = (await request.json()) as { sourcePhotoId?: string };

  if (!body.sourcePhotoId) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
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

  const taskResult = await supabase.from("tasks").select("id").eq("id", id).is("deleted_at", null).single();
  if (taskResult.error) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const currentCountResult = await supabase
    .from("task_reference_photos")
    .select("id")
    .eq("task_id", id);
  if ((currentCountResult.data?.length ?? 0) >= MAX_REFERENCE_PHOTOS) {
    return NextResponse.json({ error: "PHOTO_LIMIT_REACHED" }, { status: 400 });
  }

  const sourcePhotoResult = await supabase
    .from("task_reference_photos")
    .select("storage_path,file_name,mime_type")
    .eq("id", body.sourcePhotoId)
    .single();

  if (sourcePhotoResult.error) {
    return NextResponse.json({ error: "SOURCE_PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const { storage_path, file_name, mime_type } = sourcePhotoResult.data;

  const insertResult = await supabase
    .from("task_reference_photos")
    .insert({
      task_id: id,
      storage_path,
      file_name,
      mime_type,
      uploaded_by: actorResult.data.id,
    })
    .select("id,task_id,file_name,mime_type,storage_path,created_at")
    .single();

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    photo: {
      ...insertResult.data,
      preview_url: `/api/task-reference-photos/${insertResult.data.id}`,
    },
  });
}

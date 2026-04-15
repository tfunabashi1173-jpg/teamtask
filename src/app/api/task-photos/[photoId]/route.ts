import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getTaskPhotoBucketName } from "@/lib/tasks/photos";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ photoId: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { photoId } = await context.params;
  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id,is_active")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error || !actorResult.data.is_active) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const photoResult = await supabase
    .from("task_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const signedUrlResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .createSignedUrl(photoResult.data.storage_path, 60);

  if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
    return NextResponse.json({ error: "SIGNED_URL_FAILED" }, { status: 500 });
  }

  return NextResponse.redirect(signedUrlResult.data.signedUrl);
}

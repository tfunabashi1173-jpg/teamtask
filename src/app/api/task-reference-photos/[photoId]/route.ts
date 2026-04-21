import sharp from "sharp";
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
    .from("task_reference_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();

  if (photoResult.error) {
    return NextResponse.json({ error: "PHOTO_NOT_FOUND" }, { status: 404 });
  }

  const signedUrlResult = await supabase.storage
    .from(getTaskPhotoBucketName())
    .createSignedUrl(photoResult.data.storage_path, 86400);

  if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
    return NextResponse.json({ error: "SIGNED_URL_FAILED" }, { status: 500 });
  }

  const isThumb = request.nextUrl.searchParams.get("thumb") === "1";
  if (!isThumb) {
    const response = NextResponse.redirect(signedUrlResult.data.signedUrl);
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  }

  // Thumbnail: fetch → compress with sharp → return directly
  try {
    const imageResponse = await fetch(signedUrlResult.data.signedUrl);
    if (!imageResponse.ok) throw new Error("fetch failed");
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const compressed = await sharp(buffer)
      .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
    return new NextResponse(compressed as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=7200, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.redirect(signedUrlResult.data.signedUrl);
  }
}

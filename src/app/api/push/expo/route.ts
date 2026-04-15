import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  deactivateExpoPushToken,
  saveExpoPushToken,
} from "@/lib/notifications/expo-push";

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    expoPushToken?: string;
    deviceLabel?: string;
    platform?: "ios" | "android";
  };

  if (!body.expoPushToken || !body.platform) {
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

  await saveExpoPushToken({
    userId: actorResult.data.id,
    expoPushToken: body.expoPushToken,
    deviceLabel: body.deviceLabel,
    platform: body.platform,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as { expoPushToken?: string };
  if (!body.expoPushToken) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  await deactivateExpoPushToken(body.expoPushToken);
  return NextResponse.json({ ok: true });
}

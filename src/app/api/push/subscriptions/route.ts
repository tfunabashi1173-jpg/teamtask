import { NextRequest, NextResponse } from "next/server";
import type { WebPushSubscription } from "@/lib/notifications/web-push";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  deactivatePushSubscription,
  savePushSubscription,
} from "@/lib/notifications/web-push";

type SubscriptionPayload = Partial<WebPushSubscription>;

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    subscription?: SubscriptionPayload;
    deviceLabel?: string;
    platform?: "ios" | "android" | "web";
  };

  if (
    !body.subscription?.endpoint ||
    !body.subscription.keys?.p256dh ||
    !body.subscription.keys?.auth
  ) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION" }, { status: 400 });
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

  await savePushSubscription({
    userId: actorResult.data.id,
    subscription: body.subscription as WebPushSubscription,
    platform: body.platform ?? "web",
    deviceLabel: body.deviceLabel,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json()) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  await deactivatePushSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sendPushToUsers } from "@/lib/notifications/web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function POST(request: NextRequest) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const body = (await request.json().catch(() => null)) as { delaySeconds?: number } | null;
  const delaySeconds = Math.min(30, Math.max(1, Math.floor(body?.delaySeconds ?? 10)));

  const supabase = createSupabaseAdminClient();
  const actorResult = await supabase
    .from("app_users")
    .select("id,display_name")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (actorResult.error) {
    return NextResponse.json({ error: "ACTOR_NOT_FOUND" }, { status: 404 });
  }

  const subscriptionResult = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", actorResult.data.id)
    .eq("is_active", true)
    .limit(1);

  if (subscriptionResult.error) {
    return NextResponse.json({ error: subscriptionResult.error.message }, { status: 500 });
  }

  if (!subscriptionResult.data?.length) {
    return NextResponse.json({ error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 400 });
  }

  await sleep(delaySeconds * 1000);

  await sendPushToUsers({
    userIds: [actorResult.data.id],
    title: "Team Task テスト通知",
    body: `${delaySeconds}秒後のテスト通知です。ロック画面表示を確認してください。`,
    url: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ ok: true });
}

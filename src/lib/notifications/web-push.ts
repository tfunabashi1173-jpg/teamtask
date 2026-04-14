import webpush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type SubscriptionRecord = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active: boolean;
};

let configured = false;

function ensureVapidConfigured() {
  if (configured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export function getPublicVapidKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "";
}

export function isWebPushConfigured() {
  return Boolean(
    getPublicVapidKey() &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

function toPushSubscription(record: SubscriptionRecord): WebPushSubscription {
  return {
    endpoint: record.endpoint,
    keys: {
      p256dh: record.p256dh,
      auth: record.auth,
    },
  };
}

async function deactivateSubscription(id: string) {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("push_subscriptions")
    .update({ is_active: false })
    .eq("id", id);
}

export async function savePushSubscription({
  userId,
  subscription,
  platform,
  deviceLabel,
  userAgent,
}: {
  userId: string;
  subscription: WebPushSubscription;
  platform: "ios" | "android" | "web";
  deviceLabel?: string | null;
  userAgent?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  if (!subscription.keys?.p256dh || !subscription.keys.auth) {
    throw new Error("INVALID_SUBSCRIPTION");
  }

  const upsertResult = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      platform,
      device_label: deviceLabel ?? null,
      user_agent: userAgent ?? null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (upsertResult.error) {
    throw new Error(upsertResult.error.message);
  }
}

export async function deactivatePushSubscription(endpoint: string) {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("push_subscriptions")
    .update({ is_active: false })
    .eq("endpoint", endpoint);
}

export async function sendPushToUsers({
  userIds,
  title,
  body,
  url,
}: {
  userIds: string[];
  title: string;
  body: string;
  url: string;
}) {
  if (!isWebPushConfigured() || userIds.length === 0) {
    return;
  }

  ensureVapidConfigured();

  const supabase = createSupabaseAdminClient();
  const subscriptionsResult = await supabase
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,is_active")
    .in("user_id", userIds)
    .eq("is_active", true);

  const subscriptions =
    (subscriptionsResult.data as SubscriptionRecord[] | null) ?? [];

  await Promise.all(
    subscriptions.map(async (record) => {
      try {
        await webpush.sendNotification(
          toPushSubscription(record),
          JSON.stringify({
            title,
            body,
            url,
          }),
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof (error as { statusCode?: number }).statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : null;

        if (statusCode === 404 || statusCode === 410) {
          await deactivateSubscription(record.id);
        }
      }
    }),
  );
}

export async function sendTaskActionNotification({
  workspaceId,
  actorUserId,
  actorName,
  taskTitle,
  actionLabel,
  groupId,
  baseUrl,
}: {
  workspaceId: string;
  actorUserId: string;
  actorName: string;
  taskTitle: string;
  actionLabel: string;
  groupId: string | null;
  baseUrl: string;
}) {
  const supabase = createSupabaseAdminClient();

  let userIds: string[] = [];

  if (groupId) {
    const membersResult = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("is_active", true)
      .is("left_at", null);

    userIds = ((membersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
  } else {
    const membersResult = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("left_at", null);

    userIds = ((membersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
  }

  await sendPushToUsers({
    userIds: userIds.filter((userId) => userId !== actorUserId),
    title: "タスク更新",
    body: `${actorName}さんが「${taskTitle}」を${actionLabel}しました`,
    url: baseUrl,
  });
}

export async function sendMorningTaskNotifications({
  workspaceId,
  workspaceName,
  baseUrl,
}: {
  workspaceId: string;
  workspaceName: string;
  baseUrl: string;
}) {
  if (!isWebPushConfigured()) {
    return { sent: 0 };
  }

  const supabase = createSupabaseAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const tasksResult = await supabase
    .from("tasks")
    .select("id,title,status,group_id")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_date", today)
    .is("deleted_at", null)
    .neq("status", "done");

  const tasks = (tasksResult.data as { id: string; title: string; status: string; group_id: string | null }[] | null) ?? [];
  if (tasks.length === 0) {
    return { sent: 0 };
  }

  const workspaceMembersResult = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .is("left_at", null);

  const userIds =
    ((workspaceMembersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);

  await sendPushToUsers({
    userIds,
    title: `${workspaceName} 今日のタスク`,
    body: `本日の未完了タスクが ${tasks.length} 件あります。`,
    url: baseUrl,
  });

  return { sent: userIds.length };
}

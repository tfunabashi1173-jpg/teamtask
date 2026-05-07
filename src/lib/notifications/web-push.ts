import webpush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendExpoPushToUsers } from "@/lib/notifications/expo-push";

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

  await sendExpoPushToUsers({
    userIds,
    title,
    body,
    url,
  });
}

async function resolveNotificationTargetUserIds({
  workspaceId,
  groupId,
}: {
  workspaceId: string;
  groupId: string | null;
}) {
  const supabase = createSupabaseAdminClient();

  if (groupId) {
    const membersResult = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("is_active", true)
      .is("left_at", null);

    return ((membersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
  }

  const membersResult = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .is("left_at", null);

  return ((membersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
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
  const userIds = await resolveNotificationTargetUserIds({ workspaceId, groupId });

  await sendPushToUsers({
    userIds: userIds.filter((userId) => userId !== actorUserId),
    title: "タスク更新",
    body: `${actorName}さんが「${taskTitle}」を${actionLabel}しました`,
    url: baseUrl,
  });
}

export async function sendUrgentTaskCreatedNotification({
  workspaceId,
  actorUserId,
  actorName,
  taskTitle,
  groupId,
  includeActor,
  baseUrl,
}: {
  workspaceId: string;
  actorUserId: string;
  actorName: string;
  taskTitle: string;
  groupId: string | null;
  includeActor?: boolean;
  baseUrl: string;
}) {
  const userIds = await resolveNotificationTargetUserIds({ workspaceId, groupId });
  const targetUserIds = includeActor ? userIds : userIds.filter((userId) => userId !== actorUserId);

  await sendPushToUsers({
    userIds: targetUserIds,
    title: "緊急タスク",
    body: `${actorName}さんが緊急タスク「${taskTitle}」を登録しました`,
    url: baseUrl,
  });
}

export async function sendMembershipRequestNotification({
  workspaceId,
  requestedName,
  baseUrl,
}: {
  workspaceId: string;
  requestedName: string;
  baseUrl: string;
}) {
  const supabase = createSupabaseAdminClient();
  const adminsResult = await supabase
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);

  const adminIds = ((adminsResult.data as { id: string }[] | null) ?? []).map((row) => row.id);

  await sendPushToUsers({
    userIds: adminIds,
    title: "承認申請",
    body: `${requestedName}さんから参加申請が届きました`,
    url: baseUrl,
  });
}

export async function sendMorningTaskNotifications({
  workspaceId,
  workspaceName,
  baseUrl,
  targetDate,
}: {
  workspaceId: string;
  workspaceName: string;
  baseUrl: string;
  targetDate: string;
}) {
  if (!isWebPushConfigured()) {
    return { sent: 0 };
  }

  const supabase = createSupabaseAdminClient();
  const tasksResult = await supabase
    .from("tasks")
    .select("id,title,status,group_id")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_date", targetDate)
    .is("deleted_at", null)
    .neq("status", "done");

  const tasks = (tasksResult.data as { id: string; title: string; status: string; group_id: string | null }[] | null) ?? [];
  if (tasks.length === 0) {
    return { sent: 0 };
  }

  const deliveryClaimResult = await supabase
    .from("morning_notification_deliveries")
    .insert({
      workspace_id: workspaceId,
      target_date: targetDate,
    });

  if (deliveryClaimResult.error) {
    if (deliveryClaimResult.error.code === "23505") {
      return { sent: 0, skipped: true };
    }

    throw new Error(deliveryClaimResult.error.message);
  }

  const [workspaceMembersResult, groupResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("left_at", null),
    supabase
      .from("groups")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name")
      .limit(1)
      .maybeSingle(),
  ]);

  const userIds =
    ((workspaceMembersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
  const groupName = (groupResult.data as { name: string } | null)?.name ?? "今日のタスク";

  await sendPushToUsers({
    userIds,
    title: groupName,
    body: `本日は ${tasks.length} 件のタスクがあります。`,
    url: baseUrl,
  });

  return { sent: userIds.length };
}

export async function sendEveningTaskNotifications({
  workspaceId,
  workspaceName,
  baseUrl,
  targetDate,
}: {
  workspaceId: string;
  workspaceName: string;
  baseUrl: string;
  targetDate: string;
}) {
  if (!isWebPushConfigured()) {
    return { sent: 0 };
  }

  const supabase = createSupabaseAdminClient();
  const tasksResult = await supabase
    .from("tasks")
    .select("id,title,status,group_id")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_date", targetDate)
    .is("deleted_at", null)
    .neq("status", "done")
    .neq("status", "skipped");

  const tasks =
    (tasksResult.data as { id: string; title: string; status: string; group_id: string | null }[] | null) ?? [];
  if (tasks.length === 0) {
    return { sent: 0 };
  }

  const deliveryClaimResult = await supabase
    .from("evening_notification_deliveries")
    .insert({
      workspace_id: workspaceId,
      target_date: targetDate,
    });

  if (deliveryClaimResult.error) {
    if (deliveryClaimResult.error.code === "23505") {
      return { sent: 0, skipped: true };
    }
    throw new Error(deliveryClaimResult.error.message);
  }

  const [workspaceMembersResult, groupResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("left_at", null),
    supabase
      .from("groups")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name")
      .limit(1)
      .maybeSingle(),
  ]);

  const userIds =
    ((workspaceMembersResult.data as { user_id: string }[] | null) ?? []).map((row) => row.user_id);
  const groupName = (groupResult.data as { name: string } | null)?.name ?? "未完了タスク";

  await sendPushToUsers({
    userIds,
    title: groupName,
    body: `未完了タスクが ${tasks.length} 件あります。`,
    url: baseUrl,
  });

  return { sent: userIds.length };
}

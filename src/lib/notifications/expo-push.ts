import { createSupabaseAdminClient } from "@/lib/supabase/server";

type ExpoPushRecord = {
  id: string;
  user_id: string;
  expo_push_token: string;
  is_active: boolean;
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
};

function isExpoPushConfigured() {
  return true;
}

async function deactivateExpoPushTokenById(id: string) {
  const supabase = createSupabaseAdminClient();
  await supabase.from("expo_push_tokens").update({ is_active: false }).eq("id", id);
}

export async function saveExpoPushToken({
  userId,
  expoPushToken,
  platform,
  deviceLabel,
}: {
  userId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  deviceLabel?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  const upsertResult = await supabase.from("expo_push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      device_label: deviceLabel ?? null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" },
  );

  if (upsertResult.error) {
    throw new Error(upsertResult.error.message);
  }
}

export async function deactivateExpoPushToken(expoPushToken: string) {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("expo_push_tokens")
    .update({ is_active: false })
    .eq("expo_push_token", expoPushToken);
}

export async function sendExpoPushToUsers({
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
  if (!isExpoPushConfigured() || userIds.length === 0) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const tokensResult = await supabase
    .from("expo_push_tokens")
    .select("id,user_id,expo_push_token,is_active")
    .in("user_id", userIds)
    .eq("is_active", true);

  const tokens = (tokensResult.data as ExpoPushRecord[] | null) ?? [];
  if (tokens.length === 0) {
    return;
  }

  const messages: ExpoPushMessage[] = tokens.map((record) => ({
    to: record.expo_push_token,
    title,
    body,
    data: { url },
    sound: "default",
  }));

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("EXPO_PUSH_FAILED");
  }

  const payload = (await response.json()) as {
    data?: Array<{
      status?: string;
      details?: { error?: string };
    }>;
  };

  for (const [index, ticket] of (payload.data ?? []).entries()) {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const record = tokens[index];
      if (record) {
        await deactivateExpoPushTokenById(record.id);
      }
    }
  }
}

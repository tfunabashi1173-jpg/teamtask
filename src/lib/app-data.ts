import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { purgeExpiredCompletedTasks } from "@/lib/tasks/cleanup";
import { getTaskPhotoBucketName } from "@/lib/tasks/photos";

export type AppUser = {
  id: string;
  line_user_id: string;
  display_name: string;
  role: "admin" | "member";
  is_active: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  timezone: string;
  notification_time: string;
};

export type Group = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "done" | "skipped";
  scheduled_date: string;
  scheduled_time: string | null;
  visibility_type: "group" | "personal";
  group_id: string | null;
  owner_user_id: string | null;
  deleted_at: string | null;
  photos?: TaskPhotoRecord[];
  recurrence_rule_id?: string | null;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly";
    interval_value: number;
    days_of_week: number[] | null;
    day_of_month: number | null;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
  } | null;
};

export type TaskPhotoRecord = {
  id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  preview_url: string | null;
  created_at: string;
};

export type TaskLogRecord = {
  id: string;
  action_type: string;
  created_at: string;
  actor: {
    display_name: string;
  } | null;
  task: {
    title: string;
  } | null;
};

export type InviteRecord = {
  id: string;
  group_id: string;
  invite_token: string;
  expires_at: string;
  is_active: boolean;
};

export type MembershipRequestRecord = {
  id: string;
  group_id: string;
  requested_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  line_user_id: string;
};

export type MemberRecord = {
  id: string;
  display_name: string;
  role: "admin" | "member";
  is_active: boolean;
};

export type AppState = {
  sessionLineUserId: string | null;
  appUser: AppUser | null;
  workspace: Workspace | null;
  groups: Group[];
  tasks: TaskRecord[];
  logs: TaskLogRecord[];
  members: MemberRecord[];
  pendingRequests: MembershipRequestRecord[];
  activeInvite: InviteRecord | null;
  pendingOwnRequest: MembershipRequestRecord | null;
  needsBootstrap: boolean;
  authConfigured: boolean;
};

export async function getAppState({
  sessionLineUserId,
  inviteToken,
}: {
  sessionLineUserId: string | null;
  inviteToken: string | null;
}): Promise<AppState> {
  const authConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!authConfigured) {
    return {
      sessionLineUserId,
      appUser: null,
      workspace: null,
      groups: [],
      tasks: [],
      logs: [],
      members: [],
      pendingRequests: [],
      activeInvite: null,
      pendingOwnRequest: null,
      needsBootstrap: false,
      authConfigured: false,
    };
  }

  const supabase = createSupabaseAdminClient();

  const { count: workspaceCount } = await supabase
    .from("workspaces")
    .select("*", { count: "exact", head: true });

  const needsBootstrap = (workspaceCount ?? 0) === 0;

  let appUser: AppUser | null = null;

  if (sessionLineUserId) {
    const appUserResult = await supabase
      .from("app_users")
      .select("id,line_user_id,display_name,role,is_active")
      .eq("line_user_id", sessionLineUserId)
      .maybeSingle();

    appUser = (appUserResult.data as AppUser | null) ?? null;
  }

  let activeInvite: InviteRecord | null = null;
  if (inviteToken) {
    const inviteResult = await supabase
      .from("member_invites")
      .select("id,group_id,invite_token,expires_at,is_active")
      .eq("invite_token", inviteToken)
      .gt("expires_at", new Date().toISOString())
      .eq("is_active", true)
      .maybeSingle();

    activeInvite = (inviteResult.data as InviteRecord | null) ?? null;
  }

  let pendingOwnRequest: MembershipRequestRecord | null = null;
  if (sessionLineUserId) {
    const ownRequestResult = await supabase
      .from("membership_requests")
      .select("id,group_id,requested_name,status,created_at,line_user_id")
      .eq("line_user_id", sessionLineUserId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    pendingOwnRequest =
      (ownRequestResult.data as MembershipRequestRecord | null) ?? null;
  }

  if (!appUser || !appUser.is_active) {
    return {
      sessionLineUserId,
      appUser,
      workspace: null,
      groups: [],
      tasks: [],
      logs: [],
      members: [],
      pendingRequests: [],
      activeInvite,
      pendingOwnRequest,
      needsBootstrap,
      authConfigured,
    };
  }

  const workspaceMemberResult = await supabase
    .from("workspace_members")
    .select(
      "workspace_id, workspaces(id,name,timezone,notification_time)",
    )
    .eq("user_id", appUser.id)
    .eq("is_active", true)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  const workspaceRelation = workspaceMemberResult.data?.workspaces;
  const workspace = Array.isArray(workspaceRelation)
    ? (workspaceRelation[0] ?? null)
    : (workspaceRelation ?? null);

  if (!workspace) {
    return {
      sessionLineUserId,
      appUser,
      workspace: null,
      groups: [],
      tasks: [],
      logs: [],
      members: [],
      pendingRequests: [],
      activeInvite,
      pendingOwnRequest,
      needsBootstrap,
      authConfigured,
    };
  }

  await purgeExpiredCompletedTasks(workspace.id);

  const [groupsResult, tasksResult, logsResult, membersResult, pendingRequestsResult] =
    await Promise.all([
      supabase
        .from("groups")
        .select("id,workspace_id,name,description,is_active")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("tasks")
        .select(
          "id,title,description,priority,status,scheduled_date,scheduled_time,visibility_type,group_id,owner_user_id,deleted_at",
        )
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null)
        .order("scheduled_date")
        .order("scheduled_time"),
      supabase
        .from("task_activity_logs")
        .select(
          "id,action_type,created_at,actor:app_users!task_activity_logs_actor_user_id_fkey(display_name),task:tasks!task_activity_logs_task_id_fkey(title)",
        )
        .order("created_at", { ascending: false })
        .limit(20),
      appUser.role === "admin"
        ? supabase
            .from("workspace_members")
            .select(
              "user:app_users!workspace_members_user_id_fkey(id,display_name,role,is_active)",
            )
            .eq("workspace_id", workspace.id)
            .eq("is_active", true)
        : Promise.resolve({ data: [] }),
      appUser.role === "admin"
        ? supabase
            .from("membership_requests")
            .select("id,group_id,requested_name,status,created_at,line_user_id")
            .eq("workspace_id", workspace.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

  const baseTasks = (tasksResult.data as TaskRecord[] | null) ?? [];
  let tasks = baseTasks;

  if (baseTasks.length > 0) {
    const taskIds = baseTasks.map((task) => task.id);
    const bucket = getTaskPhotoBucketName();
    const sourceResult = await supabase
      .from("generated_task_sources")
      .select("task_id,recurrence_rule_id")
      .in("task_id", taskIds);
    const photoResult = await supabase
      .from("task_photos")
      .select("id,task_id,file_name,mime_type,storage_path,created_at")
      .in("task_id", taskIds)
      .order("created_at");

    const sourceRows =
      (sourceResult.data as { task_id: string; recurrence_rule_id: string }[] | null) ?? [];
    const photoRows =
      (photoResult.data as
        | {
            id: string;
            task_id: string;
            file_name: string;
            mime_type: string;
            storage_path: string;
            created_at: string;
          }[]
        | null) ?? [];
    const recurrenceRuleIds = Array.from(new Set(sourceRows.map((row) => row.recurrence_rule_id)));
    const signedUrlResult =
      photoRows.length > 0
        ? await supabase.storage
            .from(bucket)
            .createSignedUrls(photoRows.map((photo) => photo.storage_path), 60 * 60)
        : { data: [] };

    let recurrenceMap = new Map<
      string,
      {
        frequency: "daily" | "weekly" | "monthly";
        interval_value: number;
        days_of_week: number[] | null;
        day_of_month: number | null;
        start_date: string;
        end_date: string | null;
        is_active: boolean;
      }
    >();

    if (recurrenceRuleIds.length > 0) {
      const recurrenceResult = await supabase
        .from("recurrence_rules")
        .select("id,frequency,interval_value,days_of_week,day_of_month,start_date,end_date,is_active")
        .in("id", recurrenceRuleIds);

      recurrenceMap = new Map(
        (
          (recurrenceResult.data as
            | {
                id: string;
                frequency: "daily" | "weekly" | "monthly";
                interval_value: number;
                days_of_week: number[] | null;
                day_of_month: number | null;
                start_date: string;
                end_date: string | null;
                is_active: boolean;
              }[]
            | null) ?? []
        ).map((rule) => [rule.id, rule]),
      );
    }

    const sourceMap = new Map(sourceRows.map((row) => [row.task_id, row.recurrence_rule_id]));
    const photoUrlMap = new Map(
      (((signedUrlResult.data as { signedUrl: string | null }[] | null) ?? []).map((item, index) => [
        photoRows[index]?.storage_path,
        item?.signedUrl ?? null,
      ])),
    );
    const photoMap = new Map<string, TaskPhotoRecord[]>();

    for (const photo of photoRows) {
      const current = photoMap.get(photo.task_id) ?? [];
      current.push({
        ...photo,
        preview_url: photoUrlMap.get(photo.storage_path) ?? null,
      });
      photoMap.set(photo.task_id, current);
    }

    tasks = baseTasks.map((task) => {
      const recurrenceRuleId = sourceMap.get(task.id) ?? null;
      return {
        ...task,
        photos: photoMap.get(task.id) ?? [],
        recurrence_rule_id: recurrenceRuleId,
        recurrence: recurrenceRuleId ? recurrenceMap.get(recurrenceRuleId) ?? null : null,
      };
    });
  }

  const members =
    appUser.role === "admin"
      ? ((membersResult.data ?? [])
          .flatMap((row) => (Array.isArray(row.user) ? row.user : row.user ? [row.user] : [])) as MemberRecord[])
      : [];

  return {
    sessionLineUserId,
    appUser,
    workspace,
    groups: (groupsResult.data as Group[] | null) ?? [],
    tasks,
    logs: (logsResult.data as TaskLogRecord[] | null) ?? [],
    members,
    pendingRequests:
      (pendingRequestsResult.data as MembershipRequestRecord[] | null) ?? [],
    activeInvite,
    pendingOwnRequest,
    needsBootstrap,
    authConfigured,
  };
}

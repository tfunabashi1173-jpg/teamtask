import { createSupabaseAdminClient } from "@/lib/supabase/server";

function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const stringValue = String(value);
  return stringValue.slice(0, 10);
}

function toTimeOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  const stringValue = String(value);
  return stringValue.length >= 8 ? stringValue.slice(0, 8) : stringValue;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export type AppUser = {
  id: string;
  line_user_id: string;
  display_name: string;
  line_picture_url?: string | null;
  role: "admin" | "member";
  is_active: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  timezone: string;
  notification_time: string;
  notification_time_2: string | null;
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
  priority: "urgent" | "high" | "medium" | "low";
  status: "pending" | "in_progress" | "awaiting_confirmation" | "done" | "skipped";
  scheduled_date: string;
  scheduled_time: string | null;
  visibility_type: "group" | "personal";
  group_id: string | null;
  owner_user_id: string | null;
  deleted_at: string | null;
  photos?: TaskPhotoRecord[];
  reference_photos?: TaskPhotoRecord[];
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
  before_value?: {
    status?: string | null;
    title?: string | null;
    scheduled_date?: string | null;
    recurrence_rule_id?: string | null;
    memberName?: string | null;
  } | null;
  after_value?: {
    memberName?: string | null;
    title?: string | null;
    scheduled_date?: string | null;
    recurrence_rule_id?: string | null;
    status?: string | null;
  } | null;
  actor_name?: string | null;
  actor: {
    display_name: string;
    line_picture_url?: string | null;
  } | null;
  task: {
    id: string;
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
  line_picture_url?: string | null;
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
  rejectedOwnRequest: MembershipRequestRecord | null;
  needsBootstrap: boolean;
  bootstrapAllowed: boolean;
  authConfigured: boolean;
};

export async function getAppState({
  sessionLineUserId,
  sessionPictureUrl,
  inviteToken,
}: {
  sessionLineUserId: string | null;
  sessionPictureUrl?: string | null;
  inviteToken: string | null;
}): Promise<AppState> {
  const authConfigured = Boolean(
    process.env.NEON_DATABASE_URL,
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
      rejectedOwnRequest: null,
      needsBootstrap: false,
      bootstrapAllowed: false,
      authConfigured: false,
    };
  }

  const supabase = createSupabaseAdminClient();

  const { count: workspaceCount } = await supabase
    .from("workspaces")
    .select("*", { count: "exact", head: true });

  const needsBootstrap = (workspaceCount ?? 0) === 0;
  const bootstrapAllowedLineUserIds = (process.env.BOOTSTRAP_ALLOWED_LINE_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const bootstrapAllowed =
    needsBootstrap &&
    Boolean(
      sessionLineUserId &&
        bootstrapAllowedLineUserIds.includes(sessionLineUserId),
    );

  let appUser: AppUser | null = null;

  if (sessionLineUserId) {
    const appUserResult = await supabase
      .from("app_users")
      .select("id,line_user_id,display_name,line_picture_url,role,is_active")
      .eq("line_user_id", sessionLineUserId)
      .maybeSingle();

    appUser = (appUserResult.data as AppUser | null) ?? null;

    // セッションに写真URLがあるのにDBがNULLの場合は自動補完
    if (appUser && !appUser.line_picture_url && sessionPictureUrl) {
      await supabase
        .from("app_users")
        .update({ line_picture_url: sessionPictureUrl })
        .eq("line_user_id", sessionLineUserId);
      appUser.line_picture_url = sessionPictureUrl;
    }
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
  let rejectedOwnRequest: MembershipRequestRecord | null = null;
  if (sessionLineUserId) {
    const [pendingResult, rejectedResult] = await Promise.all([
      supabase
        .from("membership_requests")
        .select("id,group_id,requested_name,status,created_at,line_user_id")
        .eq("line_user_id", sessionLineUserId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("membership_requests")
        .select("id,group_id,requested_name,status,created_at,line_user_id")
        .eq("line_user_id", sessionLineUserId)
        .eq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    pendingOwnRequest = (pendingResult.data as MembershipRequestRecord | null) ?? null;
    rejectedOwnRequest = (rejectedResult.data as MembershipRequestRecord | null) ?? null;
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
      rejectedOwnRequest,
      needsBootstrap,
      bootstrapAllowed,
      authConfigured,
    };
  }

  const workspaceMemberResult = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", appUser.id)
    .eq("is_active", true)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  let workspace: Workspace | null = null;
  if (workspaceMemberResult.data?.workspace_id) {
    const workspaceResult = await supabase
      .from("workspaces")
      .select("id,name,timezone,notification_time,notification_time_2")
      .eq("id", workspaceMemberResult.data.workspace_id)
      .maybeSingle();
    workspace = (workspaceResult.data as Workspace | null) ?? null;
  }

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
      rejectedOwnRequest,
      needsBootstrap,
      bootstrapAllowed,
      authConfigured,
    };
  }

  const activeGroupMembershipResult =
    appUser.role === "admin"
      ? Promise.resolve({ data: [] as { group_id: string }[] })
      : supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", appUser.id)
          .eq("is_active", true)
          .is("left_at", null);

  const activeGroupMemberships = await activeGroupMembershipResult;
  const activeGroupIds =
    appUser.role === "admin"
      ? []
      : ((activeGroupMemberships.data as { group_id: string }[] | null) ?? []).map(
          (row) => row.group_id,
        );

  const [groupsResult, tasksResult, logsBaseResult, membersBaseResult, pendingRequestsResult, dismissedLogsResult] =
    await Promise.all([
      appUser.role === "admin"
        ? supabase
            .from("groups")
            .select("id,workspace_id,name,description,is_active")
            .eq("workspace_id", workspace.id)
            .eq("is_active", true)
            .order("name")
        : activeGroupIds.length > 0
          ? supabase
              .from("groups")
              .select("id,workspace_id,name,description,is_active")
              .in("id", activeGroupIds)
              .eq("is_active", true)
              .order("name")
          : Promise.resolve({ data: [] }),
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
        .select("id,action_type,created_at,before_value,after_value,actor_name,actor_user_id,task_id")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      appUser.role === "admin"
        ? supabase
            .from("workspace_members")
            .select("user_id")
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
      supabase
        .from("task_log_dismissals")
        .select("log_id")
        .eq("user_id", appUser.id),
    ]);

  const baseTasksRaw = (tasksResult.data as TaskRecord[] | null) ?? [];
  const baseTasks = baseTasksRaw.map((task) => ({
    ...task,
    scheduled_date: toDateOnly(task.scheduled_date),
    scheduled_time: toTimeOnly(task.scheduled_time),
    deleted_at: toIsoString(task.deleted_at),
  }));
  let tasks =
    appUser.role === "admin"
      ? baseTasks
      : baseTasks.filter(
          (task) =>
            task.owner_user_id === appUser.id ||
            (task.group_id ? activeGroupIds.includes(task.group_id) : false),
        );

  if (baseTasks.length > 0) {
    const taskIds = baseTasks.map((task) => task.id);
    const sourceResult = await supabase
      .from("generated_task_sources")
      .select("task_id,recurrence_rule_id")
      .in("task_id", taskIds);
    const photoResult = await supabase
      .from("task_photos")
      .select("id,task_id,file_name,mime_type,storage_path,created_at")
      .in("task_id", taskIds)
      .order("created_at");
    const referencePhotoResult = await supabase
      .from("task_reference_photos")
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
    const referencePhotoRows =
      (referencePhotoResult.data as
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
        ).map((rule) => [
          rule.id,
          {
            ...rule,
            start_date: toDateOnly(rule.start_date),
            end_date: rule.end_date ? toDateOnly(rule.end_date) : null,
          },
        ]),
      );
    }

    const sourceMap = new Map(sourceRows.map((row) => [row.task_id, row.recurrence_rule_id]));
    const photoMap = new Map<string, TaskPhotoRecord[]>();
    const referencePhotoMap = new Map<string, TaskPhotoRecord[]>();

    for (const photo of photoRows) {
      const current = photoMap.get(photo.task_id) ?? [];
      current.push({
        ...photo,
        created_at: toIsoString(photo.created_at) ?? "",
        preview_url: `/api/task-photos/${photo.id}`,
      });
      photoMap.set(photo.task_id, current);
    }

    for (const photo of referencePhotoRows) {
      const current = referencePhotoMap.get(photo.task_id) ?? [];
      current.push({
        ...photo,
        created_at: toIsoString(photo.created_at) ?? "",
        preview_url: `/api/task-reference-photos/${photo.id}`,
      });
      referencePhotoMap.set(photo.task_id, current);
    }

    tasks = baseTasks.map((task) => {
      const recurrenceRuleId = sourceMap.get(task.id) ?? null;
      return {
        ...task,
        photos: photoMap.get(task.id) ?? [],
        reference_photos: referencePhotoMap.get(task.id) ?? [],
        recurrence_rule_id: recurrenceRuleId,
        recurrence: recurrenceRuleId ? recurrenceMap.get(recurrenceRuleId) ?? null : null,
      };
    });
  }

  const logRows = (logsBaseResult.data as
    | {
        id: string;
        action_type: string;
        created_at: string;
        before_value?: TaskLogRecord["before_value"];
        after_value?: TaskLogRecord["after_value"];
        actor_name?: string | null;
        actor_user_id: string | null;
        task_id: string | null;
      }[]
    | null) ?? [];
  const logActorUserIds = Array.from(
    new Set(logRows.map((row) => row.actor_user_id).filter((value): value is string => Boolean(value))),
  );
  const logTaskIds = Array.from(
    new Set(logRows.map((row) => row.task_id).filter((value): value is string => Boolean(value))),
  );
  const [logActorsResult, logTasksResult] = await Promise.all([
    logActorUserIds.length > 0
      ? supabase
          .from("app_users")
          .select("id,display_name,line_picture_url")
          .in("id", logActorUserIds)
      : Promise.resolve({ data: [] }),
    logTaskIds.length > 0
      ? supabase
          .from("tasks")
          .select("id,title")
          .in("id", logTaskIds)
      : Promise.resolve({ data: [] }),
  ]);
  const actorMap = new Map(
    (((logActorsResult.data as { id: string; display_name: string; line_picture_url?: string | null }[] | null) ?? [])
      .map((row) => [row.id, row])),
  );
  const taskMap = new Map(
    (((logTasksResult.data as { id: string; title: string }[] | null) ?? [])
      .map((row) => [row.id, row])),
  );
  const logs: TaskLogRecord[] = logRows.map((row) => ({
    id: row.id,
    action_type: row.action_type,
    created_at: toIsoString(row.created_at) ?? "",
    before_value: row.before_value ?? null,
    after_value: row.after_value ?? null,
    actor_name: row.actor_name ?? null,
    actor: row.actor_user_id ? actorMap.get(row.actor_user_id) ?? null : null,
    task: row.task_id ? taskMap.get(row.task_id) ?? null : null,
  }));

  let members: MemberRecord[] = [];
  if (appUser.role === "admin") {
    const memberUserIds = Array.from(
      new Set(
        (((membersBaseResult.data as { user_id: string }[] | null) ?? [])
          .map((row) => row.user_id)
          .filter(Boolean)),
      ),
    );
    if (memberUserIds.length > 0) {
      const membersResult = await supabase
        .from("app_users")
        .select("id,display_name,line_picture_url,role,is_active")
        .in("id", memberUserIds);
      members = (membersResult.data as MemberRecord[] | null) ?? [];
    }
  }
  const dismissedLogIds = new Set(
    ((dismissedLogsResult.data as { log_id: string }[] | null) ?? []).map((row) => row.log_id),
  );

  return {
    sessionLineUserId,
    appUser,
    workspace,
    groups: (groupsResult.data as Group[] | null) ?? [],
    tasks,
    logs: logs.filter(
      (log) => !dismissedLogIds.has(log.id),
    ),
    members,
    pendingRequests:
      (pendingRequestsResult.data as MembershipRequestRecord[] | null) ?? [],
    activeInvite,
    pendingOwnRequest,
    rejectedOwnRequest,
    needsBootstrap,
    bootstrapAllowed,
    authConfigured,
  };
}

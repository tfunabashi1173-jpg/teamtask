import { createSupabaseAdminClient } from "@/lib/supabase/server";

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
    tasks: (tasksResult.data as TaskRecord[] | null) ?? [],
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

import { mobileEnv } from "../config/env";

export type TaskPhotoRecord = {
  id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  preview_url: string | null;
  created_at: string;
};

export type MobileTaskRecord = {
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
};

export type MobileGroup = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type MobileAppUser = {
  id: string;
  line_user_id: string;
  display_name: string;
  line_picture_url?: string | null;
  role: "admin" | "member";
  is_active: boolean;
};

export type MobileWorkspace = {
  id: string;
  name: string;
  timezone: string;
  notification_time: string;
};

export type MobileLogRecord = {
  id: string;
  action_type: string;
  created_at: string;
  actor: {
    display_name: string;
    line_picture_url?: string | null;
  } | null;
  task: {
    title: string;
  } | null;
};

export type MobileAppState = {
  sessionLineUserId: string | null;
  appUser: MobileAppUser | null;
  workspace: MobileWorkspace | null;
  groups: MobileGroup[];
  tasks: MobileTaskRecord[];
  logs: MobileLogRecord[];
  needsBootstrap: boolean;
  authConfigured: boolean;
};

export type AppStateResponse = {
  ok: boolean;
  state: MobileAppState;
};

export type SessionExchangeResponse = {
  sessionToken: string;
  user: {
    lineUserId: string;
    displayName: string | null;
    pictureUrl?: string | null;
  };
};

export type TaskAction = "start" | "confirm" | "complete" | "pause" | "postpone";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function createBackendUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimTrailingSlash(mobileEnv.webAppUrl)}${normalizedPath}`;
}

export function createAuthHeaders(sessionToken: string) {
  return {
    Authorization: `Bearer ${sessionToken}`,
  };
}

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let errorCode = `HTTP_${response.status}`;

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorCode = payload.error;
      }
    } catch {
      // Ignore JSON parse failures and keep the HTTP status.
    }

    throw new Error(errorCode);
  }

  return (await response.json()) as T;
}

export async function fetchAppState(sessionToken: string) {
  const response = await fetch(createBackendUrl("/api/app-state"), {
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<AppStateResponse>(response);
}

export async function exchangeMobileSession(requestId: string) {
  const response = await fetch(createBackendUrl("/api/auth/mobile/exchange"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ requestId }),
  });

  return readJson<SessionExchangeResponse>(response);
}

export async function postTaskAction(taskId: string, action: TaskAction, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}/actions`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ action }),
  });

  return readJson<{ ok: boolean }>(response);
}

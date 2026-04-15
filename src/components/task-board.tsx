"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  Group,
  MembershipRequestRecord,
  TaskPhotoRecord,
  TaskLogRecord,
  TaskRecord,
} from "@/lib/app-data";
import { PwaRegister } from "@/components/pwa-register";

type ActionType = "start" | "complete" | "pause" | "postpone";
type SyncState = "idle" | "queued" | "syncing" | "error";
type ScreenMode = "home" | "tasks" | "manage";

type Toast = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
};

type QueuedAction = {
  id: string;
  taskId: string;
  type: ActionType;
};

type SessionUser = {
  lineUserId: string;
  displayName: string | null;
} | null;

type TaskFormState = {
  title: string;
  description: string;
  priority: TaskRecord["priority"];
  scheduledDate: string;
  scheduledTime: string;
  recurrenceEnabled: boolean;
  recurrenceFrequency: "daily" | "weekly" | "monthly";
  recurrenceInterval: number;
  recurrenceEndDate: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: number;
};

const QUEUE_STORAGE_KEY = "team-task.queue.v2";
const MEMBER_NAME_STORAGE_KEY = "team-task.member-name";
const WEEKDAY_OPTIONS = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

function getDateStringWithOffset(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayFromDate(value: string) {
  return new Date(`${value}T00:00:00`).getDay();
}

function dayOfMonthFromDate(value: string) {
  return new Date(`${value}T00:00:00`).getDate();
}

function createDefaultTaskForm(): TaskFormState {
  const scheduledDate = getDateStringWithOffset(0);
  return {
    title: "",
    description: "",
    priority: "medium",
    scheduledDate,
    scheduledTime: "09:00",
    recurrenceEnabled: false,
    recurrenceFrequency: "daily",
    recurrenceInterval: 1,
    recurrenceEndDate: "",
    recurrenceDaysOfWeek: [weekdayFromDate(scheduledDate)],
    recurrenceDayOfMonth: dayOfMonthFromDate(scheduledDate),
  };
}

function buildTaskFormFromTask(task: TaskRecord): TaskFormState {
  const scheduledDate = task.scheduled_date;
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    scheduledDate,
    scheduledTime: task.scheduled_time?.slice(0, 5) ?? "09:00",
    recurrenceEnabled: Boolean(task.recurrence_rule_id && task.recurrence?.is_active),
    recurrenceFrequency: task.recurrence?.frequency ?? "daily",
    recurrenceInterval: task.recurrence?.interval_value ?? 1,
    recurrenceEndDate: task.recurrence?.end_date ?? "",
    recurrenceDaysOfWeek: task.recurrence?.days_of_week?.length
      ? task.recurrence.days_of_week
      : [weekdayFromDate(scheduledDate)],
    recurrenceDayOfMonth:
      task.recurrence?.day_of_month ?? dayOfMonthFromDate(scheduledDate),
  };
}

function formatPriorityIcon(priority: TaskRecord["priority"]) {
  if (priority === "high") return "🔴";
  if (priority === "medium") return "🟡";
  return "🔵";
}

function formatStatus(status: TaskRecord["status"]) {
  if (status === "pending") return "未着手";
  if (status === "in_progress") return "作業中";
  if (status === "done") return "完了";
  return "スキップ";
}

function sortTasks(tasks: TaskRecord[]) {
  const rank = { high: 0, medium: 1, low: 2 };

  return [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    return (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");
  });
}

function logMessage(log: TaskLogRecord) {
  const actor = log.actor?.display_name ?? "誰か";
  const title = log.task?.title ?? "タスク";

  if (log.action_type === "started") return `${actor}さんが「${title}」を開始しました`;
  if (log.action_type === "completed") return `${actor}さんが「${title}」を完了しました`;
  if (log.action_type === "status_changed") {
    return `${actor}さんが「${title}」を中断しました`;
  }
  if (log.action_type === "postponed_to_next_day") {
    return `${actor}さんが「${title}」を翌日に回しました`;
  }
  if (log.action_type === "priority_changed") {
    return `${actor}さんが「${title}」の優先度を変更しました`;
  }
  return `${actor}さんが「${title}」を更新しました`;
}

function formatRecurrenceSummary(task: TaskRecord) {
  if (!task.recurrence?.is_active) return null;

  const interval = Math.max(1, task.recurrence.interval_value ?? 1);
  const intervalText = interval === 1 ? "" : `${interval}`;

  if (task.recurrence.frequency === "daily") {
    return `毎${intervalText}日`;
  }

  if (task.recurrence.frequency === "weekly") {
    const days = (task.recurrence.days_of_week ?? [])
      .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label)
      .filter(Boolean)
      .join("・");
    return `毎${intervalText}週 / ${days || "曜日未設定"}`;
  }

  return `毎${intervalText}か月 / ${task.recurrence.day_of_month ?? "?"}日`;
}

export function TaskBoard({
  appVersion,
  commitSha,
  authError,
  sessionUser,
  initialState,
  inviteToken,
}: {
  appVersion: string;
  commitSha: string;
  authError: string | null;
  sessionUser: SessionUser;
  initialState: AppState;
  inviteToken: string | null;
}) {
  const [state, setState] = useState(initialState);
  const [toasts, setToasts] = useState<Toast[]>(() =>
    authError
      ? [{ id: Date.now(), tone: "error", message: authError }]
      : [],
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [queue, setQueue] = useState<QueuedAction[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  });
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const memberName =
    (typeof window !== "undefined"
      ? window.localStorage.getItem(MEMBER_NAME_STORAGE_KEY)
      : null) ??
    sessionUser?.displayName ??
    "";
  const [screenMode, setScreenMode] = useState<ScreenMode>("home");
  const [currentGroupId, setCurrentGroupId] = useState(() => initialState.groups[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [copySourceTaskId, setCopySourceTaskId] = useState<string>("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [bootstrapForm, setBootstrapForm] = useState({
    workspaceName: "",
    groupName: "",
    displayName: sessionUser?.displayName ?? "",
  });
  const [requestName, setRequestName] = useState("");
  const [taskForm, setTaskForm] = useState<TaskFormState>(createDefaultTaskForm);
  const [notificationTime, setNotificationTime] = useState(
    initialState.workspace?.notification_time?.slice(0, 5) ?? "08:00",
  );
  const [rangeStart, setRangeStart] = useState(getDateStringWithOffset(0));
  const [rangeEnd, setRangeEnd] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [isPwaMode] = useState(() => {
    if (typeof window === "undefined") return false;

    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });
  const [showPwaGuide, setShowPwaGuide] = useState(true);
  const [isIosLike] = useState(() => {
    if (typeof window === "undefined") return false;

    const ua = window.navigator.userAgent;
    const iOSDevice = /iPhone|iPad|iPod/i.test(ua);
    const iPadOnMac = /Macintosh/i.test(ua) && "ontouchend" in document;
    return iOSDevice || iPadOnMac;
  });

  const sortedTasks = useMemo(
    () =>
      sortTasks(
        state.tasks.filter(
          (task) => !task.deleted_at && (!currentGroupId || task.group_id === currentGroupId),
        ),
      ),
    [currentGroupId, state.tasks],
  );

  const rangedTasks = useMemo(
    () =>
      sortTasks(
        state.tasks.filter((task) => {
          if (task.deleted_at) return false;
          if (task.group_id !== currentGroupId) return false;
          return task.scheduled_date >= rangeStart && task.scheduled_date <= rangeEnd;
        }),
      ),
    [currentGroupId, rangeEnd, rangeStart, state.tasks],
  );

  const counts = useMemo(
    () => ({
      pending: state.tasks.filter((task) => task.status === "pending" && !task.deleted_at).length,
      inProgress: state.tasks.filter((task) => task.status === "in_progress" && !task.deleted_at)
        .length,
      done: state.tasks.filter((task) => task.status === "done" && !task.deleted_at).length,
    }),
    [state.tasks],
  );
  const selectedTask =
    selectedTaskId ? state.tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const latestLog = state.logs[0] ?? null;
  const olderLogs = state.logs.slice(1);

  function pushToast(tone: Toast["tone"], message: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }

  async function callJson(url: string, init?: RequestInit) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      let json: unknown = null;
      try {
        json = await response.json();
      } catch {}

      return { ok: response.ok, status: response.status, json };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  }

  useEffect(() => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      pushToast("success", "オンラインに復帰しました。");
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncState("queued");
      pushToast("info", "圏外です。操作を端末に保存します。");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || queue.length === 0) return;

    let cancelled = false;

    async function flushQueue() {
      setSyncState("syncing");

      for (const item of queue) {
        if (cancelled) return;
        const result = await callJson(`/api/tasks/${item.taskId}/actions`, {
          method: "POST",
          body: JSON.stringify({ action: item.type }),
        });

        if (!result.ok) {
          setSyncState("error");
          pushToast("error", "保留中の操作同期に失敗しました。");
          return;
        }
      }

      if (!cancelled) {
        setQueue([]);
        setSyncState("idle");
        pushToast("success", "保留中の操作を同期しました。");
        window.location.reload();
      }
    }

    void flushQueue();

    return () => {
      cancelled = true;
    };
  }, [isOnline, queue]);

  async function handleLogout() {
    setIsSubmitting(true);
    const result = await callJson("/api/auth/logout", { method: "POST" });
    setIsSubmitting(false);

    if (!result.ok) {
      pushToast("error", "ログアウトに失敗しました。");
      return;
    }

    window.location.href = "/";
  }

  async function handleBootstrap() {
    setIsSubmitting(true);
    const result = await callJson("/api/setup/bootstrap", {
      method: "POST",
      body: JSON.stringify(bootstrapForm),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      pushToast("error", "初期設定に失敗しました。");
      return;
    }

    window.location.reload();
  }

  async function handleMembershipRequest() {
    if (!inviteToken || !requestName.trim()) {
      pushToast("error", "名前を入力してください。");
      return;
    }

    setIsSubmitting(true);
    const result = await callJson("/api/membership-requests", {
      method: "POST",
      body: JSON.stringify({
        inviteToken,
        requestedName: requestName.trim(),
      }),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      pushToast("error", "登録申請に失敗しました。");
      return;
    }

    pushToast("success", "登録申請を送信しました。管理者の承認をお待ちください。");
    window.location.reload();
  }

  async function handleCreateInvite(groupId: string) {
    const result = await callJson(`/api/groups/${groupId}/invites`, { method: "POST" });
    if (!result.ok || !result.json || typeof result.json !== "object") {
      pushToast("error", "招待リンクの発行に失敗しました。");
      return;
    }

    const inviteUrl = (result.json as { inviteUrl?: string }).inviteUrl;
    if (!inviteUrl) {
      pushToast("error", "招待リンクの取得に失敗しました。");
      return;
    }

    setInviteLinks((current) => ({ ...current, [groupId]: inviteUrl }));
    try {
      await navigator.clipboard.writeText(inviteUrl);
      pushToast("success", "招待リンクをコピーしました。");
    } catch {
      pushToast("info", "招待リンクを表示しました。コピーして共有してください。");
    }
  }

  async function handleApproveRequest(requestId: string) {
    const result = await callJson(`/api/membership-requests/${requestId}/approve`, {
      method: "POST",
    });
    if (!result.ok) {
      pushToast("error", "承認に失敗しました。");
      return;
    }

    pushToast("success", "申請を承認しました。");
    window.location.reload();
  }

  async function handleRejectRequest(requestId: string) {
    const result = await callJson(`/api/membership-requests/${requestId}/reject`, {
      method: "POST",
    });
    if (!result.ok) {
      pushToast("error", "却下に失敗しました。");
      return;
    }

    pushToast("success", "申請を却下しました。");
    window.location.reload();
  }

  async function handleRemoveMember(userId: string) {
    const result = await callJson(`/api/members/${userId}`, { method: "DELETE" });
    if (!result.ok) {
      pushToast("error", "メンバー削除に失敗しました。");
      return;
    }

    pushToast("success", "メンバーを削除しました。履歴は保持されます。");
    window.location.reload();
  }

  async function handleSaveWorkspaceSettings() {
    const result = await callJson("/api/workspace/settings", {
      method: "PATCH",
      body: JSON.stringify({ notificationTime }),
    });

    if (!result.ok || !result.json || typeof result.json !== "object") {
      pushToast("error", "通知時刻の保存に失敗しました。");
      return;
    }

    const workspace = (result.json as { workspace?: AppState["workspace"] }).workspace;
    if (!workspace) {
      pushToast("error", "通知時刻の保存に失敗しました。");
      return;
    }

    setState((current) => ({ ...current, workspace }));
    pushToast("success", "朝通知の時刻を更新しました。");
  }

  function openEditTask(task: TaskRecord) {
    setEditingTaskId(task.id);
    setCopySourceTaskId("");
    setTaskForm({
      ...buildTaskFormFromTask(task),
    });
    setCreateTaskOpen(true);
  }

  function openCreateTask() {
    setEditingTaskId(null);
    setCopySourceTaskId("");
    setTaskForm(createDefaultTaskForm());
    setCreateTaskOpen(true);
  }

  function openTaskDetail(task: TaskRecord) {
    setSelectedTaskId(task.id);
  }

  function handleCopySourceChange(taskId: string) {
    setCopySourceTaskId(taskId);
    const sourceTask = state.tasks.find((task) => task.id === taskId);
    if (!sourceTask) return;

    setTaskForm((current) => ({
      ...current,
      ...buildTaskFormFromTask(sourceTask),
      scheduledDate: current.scheduledDate,
      recurrenceEndDate:
        sourceTask.recurrence?.end_date && sourceTask.recurrence.end_date >= current.scheduledDate
          ? sourceTask.recurrence.end_date
          : "",
      recurrenceDaysOfWeek:
        sourceTask.recurrence?.days_of_week?.length
          ? sourceTask.recurrence.days_of_week
          : [weekdayFromDate(current.scheduledDate)],
      recurrenceDayOfMonth: dayOfMonthFromDate(current.scheduledDate),
    }));
  }

  async function handleSaveTask() {
    if (!state.workspace || !taskForm.title.trim()) {
      pushToast("error", "タイトルを入力してください。");
      return;
    }

    if (taskForm.recurrenceEnabled && !taskForm.recurrenceEndDate) {
      pushToast("error", "繰り返しタスクは終了日を設定してください。");
      return;
    }

    if (
      taskForm.recurrenceEnabled &&
      taskForm.recurrenceEndDate &&
      taskForm.recurrenceEndDate < taskForm.scheduledDate
    ) {
      pushToast("error", "期間の終了日は実行日以降にしてください。");
      return;
    }

    if (
      taskForm.recurrenceEnabled &&
      taskForm.recurrenceFrequency === "weekly" &&
      taskForm.recurrenceDaysOfWeek.length === 0
    ) {
      pushToast("error", "毎週の繰り返しは曜日を1つ以上選択してください。");
      return;
    }

    const body = {
      workspaceId: state.workspace.id,
      title: taskForm.title.trim(),
      description: taskForm.description,
      priority: taskForm.priority,
      scheduledDate: taskForm.scheduledDate,
      scheduledTime: taskForm.scheduledTime,
      visibilityType: "group",
      groupId: currentGroupId,
      recurrence: {
        enabled: taskForm.recurrenceEnabled,
        frequency: taskForm.recurrenceFrequency,
        interval: taskForm.recurrenceInterval,
        endDate: taskForm.recurrenceEndDate,
        daysOfWeek: taskForm.recurrenceDaysOfWeek,
        dayOfMonth: taskForm.recurrenceDayOfMonth,
      },
    };

    const result = editingTaskId
      ? await callJson(`/api/tasks/${editingTaskId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await callJson("/api/tasks", {
          method: "POST",
          body: JSON.stringify(body),
        });

    if (!result.ok) {
      pushToast("error", editingTaskId ? "タスク更新に失敗しました。" : "タスク作成に失敗しました。");
      return;
    }

    pushToast("success", editingTaskId ? "タスクを更新しました。" : "タスクを作成しました。");
    setCreateTaskOpen(false);
    window.location.reload();
  }

  async function handleDeleteTask(taskId: string) {
    const result = await callJson(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!result.ok) {
      pushToast("error", "タスク削除に失敗しました。");
      return;
    }

    pushToast("success", "タスクを削除しました。");
    window.location.reload();
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast("success", `${label}をコピーしました。`);
    } catch {
      pushToast("error", `${label}のコピーに失敗しました。`);
    }
  }

  async function handlePhotoUpload(taskId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/tasks/${taskId}/photos`, {
        method: "POST",
        body: formData,
      });
      const json = (await response.json().catch(() => null)) as
        | { photo?: TaskPhotoRecord }
        | { error?: string }
        | null;

      if (!response.ok || !json || !("photo" in json) || !json.photo) {
        pushToast("error", "写真の保存に失敗しました。");
        return;
      }

      const createdPhoto = json.photo as TaskPhotoRecord;

      setState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? { ...task, photos: [...(task.photos ?? []), createdPhoto].slice(0, 3) }
            : task,
        ),
      }));
      pushToast("success", "写真を保存しました。");
    } catch {
      pushToast("error", "写真の保存に失敗しました。");
    }
  }

  async function handlePhotoDelete(taskId: string, photoId: string) {
    const result = await callJson(`/api/tasks/${taskId}/photos/${photoId}`, { method: "DELETE" });
    if (!result.ok) {
      pushToast("error", "写真の削除に失敗しました。");
      return;
    }

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? { ...task, photos: (task.photos ?? []).filter((photo) => photo.id !== photoId) }
          : task,
      ),
    }));
    if (previewPhotoUrl) {
      const target = selectedTask?.photos?.find((photo) => photo.id === photoId);
      if (target?.preview_url === previewPhotoUrl) {
        setPreviewPhotoUrl(null);
      }
    }
    pushToast("success", "写真を削除しました。");
  }

  async function handlePhotoReplace(taskId: string, photoId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/tasks/${taskId}/photos/${photoId}`, {
        method: "PATCH",
        body: formData,
      });
      const json = (await response.json().catch(() => null)) as
        | { photo?: TaskPhotoRecord }
        | { error?: string }
        | null;

      if (!response.ok || !json || !("photo" in json) || !json.photo) {
        pushToast("error", "写真の更新に失敗しました。");
        return;
      }

      const updatedPhoto = json.photo as TaskPhotoRecord;
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                photos: (task.photos ?? []).map((photo) =>
                  photo.id === photoId ? updatedPhoto : photo,
                ),
              }
            : task,
        ),
      }));
      pushToast("success", "写真を更新しました。");
    } catch {
      pushToast("error", "写真の更新に失敗しました。");
    }
  }

  async function performTaskAction(task: TaskRecord, action: ActionType) {
    if (action === "postpone" && task.priority === "high") {
      pushToast("error", "最優先タスクは翌日に回せません。");
      return;
    }

    const optimisticTasks = state.tasks.map((item) => {
      if (item.id !== task.id) return item;
      if (action === "start") return { ...item, status: "in_progress" as const };
      if (action === "complete") return { ...item, status: "done" as const };
      if (action === "pause") return { ...item, status: "pending" as const };
      return item;
    });

    const optimisticLog: TaskLogRecord = {
      id: `temp-${Date.now()}`,
      action_type:
        action === "start"
          ? "started"
          : action === "complete"
            ? "completed"
            : action === "pause"
              ? "status_changed"
              : "postponed_to_next_day",
      created_at: new Date().toISOString(),
      actor: { display_name: memberName || sessionUser?.displayName || "誰か" },
      task: { title: task.title },
    };

    setState((current) => ({
      ...current,
      tasks: optimisticTasks,
      logs: [optimisticLog, ...current.logs].slice(0, 20),
    }));

    if (!isOnline) {
      setQueue((current) => [
        ...current,
        { id: `${Date.now()}-${task.id}-${action}`, taskId: task.id, type: action },
      ]);
      setSyncState("queued");
      pushToast("info", "圏外のため操作を端末に保存しました。");
      return;
    }

    const result = await callJson(`/api/tasks/${task.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });

    if (!result.ok) {
      pushToast("error", "操作に失敗しました。通信状態を確認してください。");
      window.location.reload();
      return;
    }

    pushToast(
      "success",
      action === "start"
        ? `「${task.title}」を開始しました。`
        : action === "complete"
          ? `「${task.title}」を完了しました。`
          : action === "pause"
            ? `「${task.title}」を中断しました。`
            : `「${task.title}」を翌日に回しました。`,
    );
  }

  if (!state.authConfigured) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
        <Card title="Supabase未設定">
          <p className="text-sm text-[var(--muted)]">
            `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を `.env.local`
            に設定してください。
          </p>
        </Card>
      </Shell>
    );
  }

  if (!sessionUser) {
    return (
      <LoginScreen
        appVersion={appVersion}
        commitSha={commitSha}
        toasts={toasts}
      />
    );
  }

  if (state.needsBootstrap) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
        <Card title="初期設定">
          <p className="mb-4 text-sm text-[var(--muted)]">
            最初の管理者としてワークスペースと最初のグループを作成します。
          </p>
          <FormField label="表示名">
            <input
              className={inputClass}
              value={bootstrapForm.displayName}
              onChange={(event) =>
                setBootstrapForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="ワークスペース名">
            <input
              className={inputClass}
              value={bootstrapForm.workspaceName}
              onChange={(event) =>
                setBootstrapForm((current) => ({
                  ...current,
                  workspaceName: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="最初のグループ名">
            <input
              className={inputClass}
              value={bootstrapForm.groupName}
              onChange={(event) =>
                setBootstrapForm((current) => ({
                  ...current,
                  groupName: event.target.value,
                }))
              }
            />
          </FormField>
          <button
            className={primaryButtonClass}
            onClick={handleBootstrap}
            type="button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "作成中..." : "初期設定を完了"}
          </button>
        </Card>
      </Shell>
    );
  }

  if (!state.appUser) {
    if (state.pendingOwnRequest) {
      return (
        <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
          <Card title="承認待ち">
            <p className="text-sm leading-7 text-[var(--muted)]">
              登録申請を送信済みです。管理者の承認後に利用可能になります。
            </p>
            <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              申請名: {state.pendingOwnRequest.requested_name}
            </div>
          </Card>
        </Shell>
      );
    }

    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
        <Card title="登録申請">
          {state.activeInvite ? (
            <>
              <p className="mb-4 text-sm leading-7 text-[var(--muted)]">
                招待リンクを確認しました。名前を入力して登録申請を送信してください。
              </p>
              <FormField label="登録名">
                <input
                  className={inputClass}
                  value={requestName}
                  onChange={(event) => setRequestName(event.target.value)}
                />
              </FormField>
              <button
                className={primaryButtonClass}
                onClick={handleMembershipRequest}
                type="button"
                disabled={isSubmitting}
              >
                {isSubmitting ? "送信中..." : "登録申請を送信"}
              </button>
            </>
          ) : (
            <p className="text-sm leading-7 text-[var(--muted)]">
              有効な招待リンクがありません。グループメンバーから招待URLを受け取ってください。
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      appVersion={appVersion}
      commitSha={commitSha}
      toasts={toasts}
      enablePushPrompt
    >
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--muted)]">{new Date().toLocaleDateString("ja-JP")}</p>
            <h1 className="mt-2 font-[family-name:var(--font-heading)] text-[2rem] leading-none tracking-[-0.03em]">
              今日のタスク
            </h1>
          </div>
          <div className="flex gap-2">
            <button className={primaryIconButtonClass} onClick={openCreateTask} type="button">
              +
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <SummaryCard label="未着手" value={counts.pending} tone="default" />
          <SummaryCard label="作業中" value={counts.inProgress} tone="warning" />
          <SummaryCard label="完了" value={counts.done} tone="success" />
        </div>

        <div className="mt-4 flex gap-2">
          <select
            className={inputClass}
            value={currentGroupId}
            onChange={(event) => setCurrentGroupId(event.target.value)}
          >
            {state.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <button
            className={secondaryButtonClass}
            onClick={() => setScreenMode("tasks")}
            type="button"
          >
            一覧
          </button>
        </div>

        {!isOnline || syncState !== "idle" ? (
          <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-3 text-sm text-[var(--ink-soft)]">
            {!isOnline
              ? "圏外のため操作は端末に保留されます"
              : syncState === "queued"
                ? `保留 ${queue.length}件を同期待ちです`
                : syncState === "syncing"
                  ? "保留中の操作を同期しています"
                  : "同期に失敗しました。通信状態を確認してください"}
          </div>
        ) : null}
      </Card>

      {state.appUser.role === "admin" && state.pendingRequests.length > 0 ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--danger)]">承認待ち申請があります</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {state.pendingRequests.length}件の申請が管理画面で承認待ちです。
              </p>
            </div>
            <button
              className={secondaryButtonClass}
              onClick={() => setScreenMode("manage")}
              type="button"
            >
              確認
            </button>
          </div>
        </Card>
      ) : null}

      {!isPwaMode && showPwaGuide && screenMode !== "manage" ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--brand)]">
                通知を受けるにはPWA登録が必要です
              </p>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                {isIosLike
                  ? "Safariの共有メニューから「ホーム画面に追加」を行ってください。ホーム画面から起動すると通知とPWA機能を使えます。"
                  : "このページをホーム画面に追加してください。PWAとして起動すると通知とオフライン機能を使えます。"}
              </p>
            </div>
            <button
              className={secondaryButtonClass}
              onClick={() => setShowPwaGuide(false)}
              type="button"
            >
              閉じる
            </button>
          </div>
        </Card>
      ) : null}

      {screenMode === "home" ? (
        <section className="grid gap-4">
          {sortedTasks.map((task) => (
            <button
              key={task.id}
              className="w-full rounded-[28px] bg-white px-5 py-5 text-left shadow-[0_12px_30px_rgba(31,41,51,0.08)]"
              onClick={() => openTaskDetail(task)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                    {task.status !== "done" ? `${formatPriorityIcon(task.priority)} ` : ""}
                    {task.status === "done" ? "✅ " : ""}
                    {task.title}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    状態: {formatStatus(task.status)}
                  </p>
                  {task.recurrence?.is_active ? (
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      繰り返し: {formatRecurrenceSummary(task)}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-xl bg-[var(--chip)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
                  詳細
                </span>
              </div>
              {task.description ? (
                <p className="mt-4 line-clamp-2 text-sm leading-7 text-[var(--ink-soft)]">
                  {task.description}
                </p>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      {screenMode === "tasks" ? (
        <>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                  タスク一覧
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  期間を指定してタスクを確認します。
                </p>
              </div>
              <button
                className={secondaryButtonClass}
                onClick={() => setScreenMode("home")}
                type="button"
              >
                戻る
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <FormField label="開始日">
                <input
                  className={inputClass}
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                />
              </FormField>
              <FormField label="終了日">
                <input
                  className={inputClass}
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                />
              </FormField>
            </div>
          </Card>

          <section className="grid gap-4">
            {rangedTasks.map((task) => (
              <Card key={task.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                      {task.status !== "done" ? `${formatPriorityIcon(task.priority)} ` : ""}
                      {task.status === "done" ? "✅ " : ""}
                      {task.title}
                    </h2>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {task.scheduled_date} {task.scheduled_time?.slice(0, 5) ?? ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={secondaryButtonClass}
                      onClick={() => openEditTask(task)}
                      type="button"
                    >
                      編集
                    </button>
                    <button
                      className={secondaryButtonClass}
                      onClick={() => {
                        setScreenMode("home");
                        openCreateTask();
                        handleCopySourceChange(task.id);
                      }}
                      type="button"
                    >
                      コピー
                    </button>
                    <button
                      className="rounded-2xl border border-[var(--danger)] px-4 py-3 text-sm font-semibold text-[var(--danger)]"
                      onClick={() => handleDeleteTask(task.id)}
                      type="button"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </section>
        </>
      ) : null}

      {screenMode === "home" ? (
        <Card title="通知">
          <div className="flex flex-col gap-3">
            {latestLog ? (
              <div className="rounded-2xl bg-[var(--chip)] px-4 py-3">
                <p className="text-sm leading-6">{logMessage(latestLog)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {new Date(latestLog.created_at).toLocaleString("ja-JP")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">通知はまだありません。</p>
            )}

            {olderLogs.length > 0 ? (
              <>
                <button
                  className={secondaryButtonClass}
                  onClick={() => setShowAllLogs((current) => !current)}
                  type="button"
                >
                  {showAllLogs ? "過去の通知を閉じる" : `過去の通知 ${olderLogs.length} 件`}
                </button>
                {showAllLogs ? (
                  <div className="flex flex-col gap-3">
                    {olderLogs.map((log) => (
                      <div key={log.id} className="rounded-2xl bg-[var(--surface)] px-4 py-3">
                        <p className="text-sm leading-6">{logMessage(log)}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {new Date(log.created_at).toLocaleString("ja-JP")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {screenMode === "manage" && state.appUser.role === "admin" ? (
        <>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                  管理画面
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  メンバー承認、招待、削除をここで行います。
                </p>
              </div>
              <button
                className={secondaryButtonClass}
                onClick={() => setScreenMode("home")}
                type="button"
              >
                戻る
              </button>
            </div>
          </Card>
          <Card title="承認待ち申請">
            {state.pendingRequests.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">承認待ちはありません。</p>
            ) : (
              <div className="flex flex-col gap-3">
                {state.pendingRequests.map((item) => (
                  <PendingRequestCard
                    key={item.id}
                    groups={state.groups}
                    item={item}
                    onApprove={() => handleApproveRequest(item.id)}
                    onReject={() => handleRejectRequest(item.id)}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="メンバー管理">
            <div className="flex flex-col gap-3">
              {state.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-2xl bg-[var(--chip)] px-4 py-3"
                >
                  <div>
                    <p className="font-semibold">{member.display_name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.role}</p>
                  </div>
                  <button
                    className="rounded-xl border border-[var(--danger)] px-3 py-2 text-xs font-semibold text-[var(--danger)]"
                    onClick={() => handleRemoveMember(member.id)}
                    type="button"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card title="通知設定">
            <div className="grid gap-3">
              <FormField label="朝通知時刻">
                <input
                  className={inputClass}
                  type="time"
                  value={notificationTime}
                  onChange={(event) => setNotificationTime(event.target.value)}
                />
              </FormField>
              <p className="text-xs text-[var(--muted)]">
                現在のタイムゾーン: {state.workspace?.timezone ?? "Asia/Tokyo"}
              </p>
              <button
                className={primaryButtonClass}
                onClick={handleSaveWorkspaceSettings}
                type="button"
              >
                通知時刻を保存
              </button>
            </div>
          </Card>
        </>
      ) : null}

      {screenMode === "manage" ? (
        <Card title="グループ招待">
        <div className="flex flex-col gap-4">
          {state.groups.map((group) => (
            <div key={group.id} className="rounded-2xl bg-[var(--chip)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{group.name}</p>
                  <p className="text-xs text-[var(--muted)]">24時間有効の招待リンク</p>
                </div>
                <button
                  className={secondaryButtonClass}
                  onClick={() => handleCreateInvite(group.id)}
                  type="button"
                >
                  招待リンク発行
                </button>
              </div>
              {inviteLinks[group.id] ? (
                <p className="mt-3 break-all rounded-xl bg-white px-3 py-2 text-xs text-[var(--ink-soft)]">
                  {inviteLinks[group.id]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        </Card>
      ) : null}

      <section className="rounded-[28px] bg-white px-4 py-4 shadow-[0_12px_30px_rgba(31,41,51,0.06)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--muted)]">
              WORKSPACE
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">
              {state.workspace?.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {state.appUser.role === "admin" ? (
              <button
                className={toolbarButtonClass}
                onClick={() =>
                  setScreenMode((current) => (current === "home" ? "manage" : "home"))
                }
                type="button"
              >
                <span className="text-base">{screenMode === "home" ? "⚙" : "⌂"}</span>
                <span>{screenMode === "home" ? "管理" : "今日"}</span>
              </button>
            ) : null}
            <button
              className={toolbarDangerButtonClass}
              onClick={handleLogout}
              type="button"
              disabled={isSubmitting}
            >
              <span className="text-base">⇥</span>
              <span>{isSubmitting ? "処理中" : "退出"}</span>
            </button>
          </div>
        </div>
      </section>

      {createTaskOpen ? (
        <TaskModal
          currentGroupName={
            state.groups.find((group) => group.id === currentGroupId)?.name ?? "グループ未設定"
          }
          availableCopyTasks={state.tasks.filter(
            (task) => !task.deleted_at && task.group_id === currentGroupId,
          )}
          copySourceTaskId={copySourceTaskId}
          form={taskForm}
          isEditing={Boolean(editingTaskId)}
          onCopySourceChange={handleCopySourceChange}
          onClose={() => setCreateTaskOpen(false)}
          onSave={handleSaveTask}
          setForm={setTaskForm}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onCopyText={copyText}
          onAction={(action) => void performTaskAction(selectedTask, action)}
          onPhotoUpload={(file) => void handlePhotoUpload(selectedTask.id, file)}
          onPhotoDelete={(photoId) => void handlePhotoDelete(selectedTask.id, photoId)}
          onPhotoReplace={(photoId, file) => void handlePhotoReplace(selectedTask.id, photoId, file)}
          onPreview={(url) => setPreviewPhotoUrl(url)}
        />
      ) : null}

      {previewPhotoUrl ? (
        <ImagePreviewModal imageUrl={previewPhotoUrl} onClose={() => setPreviewPhotoUrl(null)} />
      ) : null}
    </Shell>
  );
}

function Shell({
  children,
  appVersion,
  commitSha,
  toasts,
  enablePushPrompt = false,
}: {
  children: React.ReactNode;
  appVersion: string;
  commitSha: string;
  toasts: Toast[];
  enablePushPrompt?: boolean;
}) {
  return (
    <>
      <PwaRegister enablePushPrompt={enablePushPrompt} />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[var(--surface)] px-5 pb-8 pt-4 text-[var(--ink)]">
        <div className="mx-auto mb-4 h-1.5 w-20 rounded-full bg-black/10" />
        <div className="flex flex-col gap-4">{children}</div>
        <Footer appVersion={appVersion} commitSha={commitSha} />
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-[0_16px_30px_rgba(15,23,42,0.18)] ${
              toast.tone === "success"
                ? "bg-[var(--brand)]"
                : toast.tone === "info"
                  ? "bg-[var(--ink)]"
                  : "bg-[var(--danger)]"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
}

function LoginScreen({
  appVersion,
  commitSha,
  toasts,
}: {
  appVersion: string;
  commitSha: string;
  toasts: Toast[];
}) {
  return (
    <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
      <Card>
        <p className="text-sm font-semibold tracking-[0.08em] text-[var(--brand)]">TEAM TASK</p>
        <h1 className="mt-3 font-[family-name:var(--font-heading)] text-[2.3rem] leading-none tracking-[-0.05em]">
          チームの今日を
          <br />
          すぐ動かす
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
          LINEでログインして、オフライン対応のPWAとして利用します。
        </p>
        <a
          className="mt-8 flex h-14 items-center justify-center rounded-2xl bg-[var(--brand)] text-base font-semibold text-white"
          href="/api/auth/line/login"
        >
          LINEでログイン
        </a>
      </Card>
    </Shell>
  );
}

function Card({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <section className="rounded-[28px] bg-white px-5 py-5 shadow-[0_12px_30px_rgba(31,41,51,0.08)]">
      {title ? (
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-[var(--warning-bg)] text-[var(--warning-ink)]"
      : tone === "success"
        ? "bg-[var(--success-bg)] text-[var(--success-ink)]"
        : "bg-[var(--surface)] text-[var(--ink-soft)]";

  return (
    <div className={`rounded-2xl px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-semibold tracking-[0.06em]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: "warning" | "success" | "neutral";
}) {
  const toneClass =
    tone === "warning"
      ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-ink)]"
      : tone === "success"
        ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-ink)]"
        : "border-black/10 bg-white text-[var(--ink-soft)]";

  return (
    <button
      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${toneClass}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function PendingRequestCard({
  item,
  groups,
  onApprove,
  onReject,
}: {
  item: MembershipRequestRecord;
  groups: Group[];
  onApprove: () => void;
  onReject: () => void;
}) {
  const groupName = groups.find((group) => group.id === item.group_id)?.name ?? "不明";

  return (
    <div className="rounded-2xl bg-[var(--chip)] px-4 py-4">
      <p className="font-semibold">{item.requested_name}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">申請先: {groupName}</p>
      <div className="mt-3 flex gap-2">
        <button className={primaryButtonClass} onClick={onApprove} type="button">
          承認
        </button>
        <button className={secondaryDangerClass} onClick={onReject} type="button">
          却下
        </button>
      </div>
    </div>
  );
}

function TaskModal({
  currentGroupName,
  availableCopyTasks,
  copySourceTaskId,
  form,
  setForm,
  onClose,
  onSave,
  isEditing,
  onCopySourceChange,
}: {
  currentGroupName: string;
  availableCopyTasks: TaskRecord[];
  copySourceTaskId: string;
  form: TaskFormState;
  setForm: React.Dispatch<React.SetStateAction<TaskFormState>>;
  onClose: () => void;
  onSave: () => void;
  isEditing: boolean;
  onCopySourceChange: (taskId: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-t-[32px] bg-white px-5 py-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
          {isEditing ? "タスク編集" : "新しいタスク"}
        </h3>
        <div className="mt-4 grid gap-3">
          {availableCopyTasks.length > 0 ? (
            <FormField label="既存タスクをコピー">
              <select
                className={inputClass}
                value={copySourceTaskId}
                onChange={(event) => onCopySourceChange(event.target.value)}
              >
                <option value="">選択しない</option>
                {availableCopyTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField label="タイトル">
            <input
              className={inputClass}
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </FormField>
          <FormField label="説明">
            <textarea
              className={`${inputClass} min-h-24`}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </FormField>
          <FormField label="追加先グループ">
            <div className={`${inputClass} bg-[var(--chip)] text-[var(--ink-soft)]`}>
              {currentGroupName}
            </div>
          </FormField>
          <FormField label="優先度">
            <select
              className={inputClass}
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value as TaskRecord["priority"],
                }))
              }
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="実行日">
              <input
                className={inputClass}
                type="date"
                value={form.scheduledDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledDate: event.target.value,
                    recurrenceDaysOfWeek:
                      current.recurrenceFrequency === "weekly"
                        ? [weekdayFromDate(event.target.value)]
                        : current.recurrenceDaysOfWeek,
                    recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                  }))
                }
              />
            </FormField>
            <FormField label="時間">
              <input
                className={inputClass}
                type="time"
                value={form.scheduledTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledTime: event.target.value,
                  }))
                }
              />
            </FormField>
          </div>
          <div className="rounded-3xl bg-[var(--surface)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">繰り返し</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  期間内の繰り返しタスクをまとめて作成します。
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={form.recurrenceEnabled}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      recurrenceEnabled: event.target.checked,
                      recurrenceEndDate:
                        event.target.checked && !current.recurrenceEndDate
                          ? current.scheduledDate
                          : current.recurrenceEndDate,
                    }))
                  }
                />
                有効
              </label>
            </div>

            {form.recurrenceEnabled ? (
              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="繰り返し">
                    <select
                      className={inputClass}
                      value={form.recurrenceFrequency}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          recurrenceFrequency: event.target.value as TaskFormState["recurrenceFrequency"],
                          recurrenceDaysOfWeek:
                            event.target.value === "weekly"
                              ? [weekdayFromDate(current.scheduledDate)]
                              : current.recurrenceDaysOfWeek,
                        }))
                      }
                    >
                      <option value="daily">毎日</option>
                      <option value="weekly">曜日指定（毎週）</option>
                      <option value="monthly">毎月</option>
                    </select>
                  </FormField>
                  <FormField label="間隔">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      value={form.recurrenceInterval}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          recurrenceInterval: Math.max(1, Number(event.target.value || 1)),
                        }))
                      }
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="期間開始">
                    <div className={`${inputClass} bg-[var(--chip)] text-[var(--ink-soft)]`}>
                      {form.scheduledDate}
                    </div>
                  </FormField>
                  <FormField label="期間終了">
                    <input
                      className={inputClass}
                      type="date"
                      value={form.recurrenceEndDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          recurrenceEndDate: event.target.value,
                        }))
                      }
                    />
                  </FormField>
              </div>

              {form.recurrenceFrequency === "weekly" ? (
                <p className="text-xs text-[var(--muted)]">
                  曜日指定で繰り返すには、下の曜日ボタンを選択してください。
                </p>
              ) : null}

                {form.recurrenceFrequency === "weekly" ? (
                  <FormField label="曜日">
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_OPTIONS.map((option) => {
                        const checked = form.recurrenceDaysOfWeek.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            className={`rounded-2xl border px-4 py-2 text-sm font-semibold ${
                              checked
                                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                : "border-black/10 bg-white text-[var(--ink-soft)]"
                            }`}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                recurrenceDaysOfWeek: checked
                                  ? current.recurrenceDaysOfWeek.filter((day) => day !== option.value)
                                  : [...current.recurrenceDaysOfWeek, option.value].sort((a, b) => a - b),
                              }))
                            }
                            type="button"
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </FormField>
                ) : null}

                {form.recurrenceFrequency === "monthly" ? (
                  <FormField label="毎月の日">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={31}
                      value={form.recurrenceDayOfMonth}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          recurrenceDayOfMonth: Math.min(
                            31,
                            Math.max(1, Number(event.target.value || dayOfMonthFromDate(current.scheduledDate))),
                          ),
                        }))
                      }
                    />
                  </FormField>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button className={secondaryButtonClass} onClick={onClose} type="button">
            閉じる
          </button>
          <button className={primaryButtonClass} onClick={onSave} type="button">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal({
  task,
  onClose,
  onCopyText,
  onAction,
  onPhotoUpload,
  onPhotoDelete,
  onPhotoReplace,
  onPreview,
}: {
  task: TaskRecord;
  onClose: () => void;
  onCopyText: (label: string, value: string) => Promise<void>;
  onAction: (action: ActionType) => void;
  onPhotoUpload: (file: File) => void;
  onPhotoDelete: (photoId: string) => void;
  onPhotoReplace: (photoId: string, file: File) => void;
  onPreview: (url: string) => void;
}) {
  const [isPhotoSubmitting, setIsPhotoSubmitting] = useState(false);
  const addPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const shouldOpenPhotoPickerOnDoneRef = useRef(false);

  useEffect(() => {
    if (!shouldOpenPhotoPickerOnDoneRef.current || task.status !== "done") return;

    addPhotoInputRef.current?.click();
    shouldOpenPhotoPickerOnDoneRef.current = false;
  }, [task.status]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-t-[32px] bg-white px-5 py-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
              {task.status !== "done" ? `${formatPriorityIcon(task.priority)} ` : ""}
              {task.status === "done" ? "✅ " : ""}
              {task.title}
            </h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {task.scheduled_date} {task.scheduled_time?.slice(0, 5) ?? "時刻未設定"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">状態: {formatStatus(task.status)}</p>
          </div>
          <button className={secondaryButtonClass} onClick={onClose} type="button">
            閉じる
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--ink)]">タイトル</p>
              <button
                className={iconButtonClass}
                onClick={() => void onCopyText("タイトル", task.title)}
                type="button"
                aria-label="タイトルをコピー"
              >
                ⧉
              </button>
            </div>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{task.title}</p>
          </div>

          {task.description ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--ink)]">説明</p>
                <button
                  className={iconButtonClass}
                  onClick={() => void onCopyText("説明", task.description ?? "")}
                  type="button"
                  aria-label="説明をコピー"
                >
                  ⧉
                </button>
              </div>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{task.description}</p>
            </div>
          ) : null}

          {task.recurrence?.is_active ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--ink)]">繰り返し</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{formatRecurrenceSummary(task)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                期間: {task.recurrence.start_date} - {task.recurrence.end_date ?? "終了日なし"}
              </p>
            </div>
          ) : null}

          {task.status !== "done" ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--ink)]">完了写真</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                完了後に最大3枚まで登録できます。完了と同時に写真登録へ進むこともできます。
              </p>
            </div>
          ) : null}

          {task.status === "done" ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">完了写真</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    最大3枚まで登録できます。
                  </p>
                </div>
                {(task.photos?.length ?? 0) < 3 ? (
                  <label className={secondaryButtonClass}>
                    写真追加
                    <input
                      ref={addPhotoInputRef}
                      className="hidden"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={isPhotoSubmitting}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        setIsPhotoSubmitting(true);
                        await Promise.resolve(onPhotoUpload(file));
                        setIsPhotoSubmitting(false);
                      }}
                    />
                  </label>
                ) : (
                  <span className="text-xs font-semibold text-[var(--muted)]">3 / 3枚</span>
                )}
              </div>

              {task.photos?.length ? (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {task.photos.map((photo) => (
                    <div key={photo.id} className="relative">
                      <button
                        className="block aspect-square w-full overflow-hidden rounded-2xl bg-white"
                        onClick={() => photo.preview_url && onPreview(photo.preview_url)}
                        type="button"
                      >
                        {photo.preview_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={photo.file_name}
                            className="h-full w-full object-cover"
                            src={photo.preview_url}
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-xs text-[var(--muted)]">
                            画像
                          </span>
                        )}
                      </button>
                      <button
                        className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-[var(--danger)]"
                        onClick={() => onPhotoDelete(photo.id)}
                        type="button"
                      >
                        削除
                      </button>
                      <label className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-[var(--ink-soft)]">
                        更新
                        <input
                          className="hidden"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            setIsPhotoSubmitting(true);
                            await Promise.resolve(onPhotoReplace(photo.id, file));
                            setIsPhotoSubmitting(false);
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">写真はまだありません。</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {task.status === "pending" ? (
            <ActionButton label="開始" onClick={() => onAction("start")} tone="warning" />
          ) : null}
          {task.status !== "done" ? (
            <ActionButton label="完了" onClick={() => onAction("complete")} tone="success" />
          ) : null}
          {task.status !== "done" ? (
            <ActionButton
              label="完了して写真"
              onClick={() => {
                shouldOpenPhotoPickerOnDoneRef.current = true;
                onAction("complete");
              }}
              tone="success"
            />
          ) : null}
          {task.status === "in_progress" ? (
            <ActionButton label="中断" onClick={() => onAction("pause")} tone="neutral" />
          ) : null}
          {task.status !== "done" && task.priority !== "high" ? (
            <ActionButton label="翌日に回す" onClick={() => onAction("postpone")} tone="neutral" />
          ) : null}
          {task.status !== "done" && task.priority === "high" ? (
            <span className="inline-flex items-center rounded-2xl border border-dashed border-[var(--danger)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">
              最優先のため延期不可
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImagePreviewModal({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <button className="absolute right-4 top-4 z-10 rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)]" onClick={onClose} type="button">
        閉じる
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="完了写真プレビュー"
        className="max-h-full max-w-full rounded-3xl object-contain"
        onMouseDown={(event) => event.stopPropagation()}
        src={imageUrl}
      />
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function Footer({
  appVersion,
  commitSha,
}: {
  appVersion: string;
  commitSha: string;
}) {
  return (
    <footer className="mt-6 rounded-[28px] bg-white px-5 py-4 text-sm text-[var(--muted)] shadow-[0_12px_30px_rgba(31,41,51,0.06)]">
      <div className="flex items-center justify-between">
        <span>アプリ版</span>
        <span className="font-medium text-[var(--ink)]">
          {appVersion} ({commitSha})
        </span>
      </div>
    </footer>
  );
}

const inputClass =
  "rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none";
const primaryButtonClass =
  "rounded-2xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white";
const primaryIconButtonClass =
  "flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand)] text-xl text-white";
const secondaryButtonClass =
  "rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)]";
const secondaryDangerClass =
  "rounded-2xl border border-[var(--danger)] bg-white px-4 py-3 text-sm font-semibold text-[var(--danger)]";
const toolbarButtonClass =
  "inline-flex items-center gap-2 rounded-2xl bg-[var(--chip)] px-4 py-3 text-sm font-semibold text-[var(--ink-soft)]";
const toolbarDangerButtonClass =
  "inline-flex items-center gap-2 rounded-2xl border border-[var(--danger)]/25 bg-[#FFF8F7] px-4 py-3 text-sm font-semibold text-[var(--danger)]";
const iconButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-white text-sm text-[var(--ink-soft)]";

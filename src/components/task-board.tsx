"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  Group,
  MembershipRequestRecord,
  TaskPhotoRecord,
  TaskLogRecord,
  TaskRecord,
} from "@/lib/app-data";
import { PwaRegister } from "@/components/pwa-register";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type ActionType = "start" | "confirm" | "complete" | "pause" | "postpone";
type SyncState = "idle" | "queued" | "syncing" | "error";
type ScreenMode = "home" | "tasks" | "notifications" | "bulk";

type Toast = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
};

type PushSetupNotice = {
  tone: "info" | "error";
  message: string;
  actionLabel?: string;
  actionType?: "request_permission" | "register_subscription";
};

type DevicePermissionNotice = {
  tone: "info" | "error";
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
  pictureUrl?: string | null;
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

type BatchTaskRow = {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  description: string;
  priority: TaskRecord["priority"];
  recurrenceEnabled: boolean;
  recurrenceFrequency: "daily" | "weekly" | "monthly";
  recurrenceInterval: number;
  recurrenceEndDate: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: number;
  pendingReferenceFiles: File[];
};

const QUEUE_STORAGE_KEY = "team-task.queue.v2";
const MEMBER_NAME_STORAGE_KEY = "team-task.member-name";
const VERSION_CHECK_STORAGE_KEY = "team-task.version-check";
const LINE_LOGIN_ATTEMPT_STORAGE_KEY = "team-task.line-login-attempt";
const PENDING_INVITE_STORAGE_KEY = "team-task.pending-invite";
const WEEKDAY_OPTIONS = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

function base64UrlToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function getDateStringWithOffset(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInputValue(date);
}

function shiftDateString(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateInputValue(date);
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(value: string) {
  if (!value) return "日付を選択";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}/${month}/${day}`;
}

function formatTimeDisplay(value: string) {
  if (!value) return "時刻を選択";
  return value.slice(0, 5);
}

function formatHomeHeadingDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function scheduledTimeToSlot(value: string | null | undefined) {
  if (!value) return "anytime";
  const normalized = value.slice(0, 5);
  if (normalized <= "11:59") return "morning";
  if (normalized <= "16:59") return "afternoon";
  return "anytime";
}

function slotToScheduledTime(slot: "morning" | "afternoon" | "anytime") {
  if (slot === "morning") return "09:00";
  if (slot === "afternoon") return "13:00";
  return "17:00";
}

function slotLabel(slot: "morning" | "afternoon" | "anytime") {
  if (slot === "morning") return "午前中";
  if (slot === "afternoon") return "午後中";
  return "当日中";
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

function createBatchTaskRow(date = getDateStringWithOffset(0)): BatchTaskRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scheduledDate: date,
    scheduledTime: "09:00",
    title: "",
    description: "",
    priority: "medium",
    recurrenceEnabled: false,
    recurrenceFrequency: "daily",
    recurrenceInterval: 1,
    recurrenceEndDate: "",
    recurrenceDaysOfWeek: [weekdayFromDate(date)],
    recurrenceDayOfMonth: dayOfMonthFromDate(date),
    pendingReferenceFiles: [],
  };
}

function normalizeBatchPriority(value: string): TaskRecord["priority"] {
  const normalized = value.trim().toLowerCase();
  if (["緊急", "urgent", "u"].includes(normalized)) return "urgent";
  if (["高", "high", "h"].includes(normalized)) return "high";
  if (["低", "low", "l"].includes(normalized)) return "low";
  return "medium";
}

function parseBatchTaskRows(raw: string, fallbackDate: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [scheduledDate, scheduledTime, title, description, priority] = line.split("\t");
      return {
        ...createBatchTaskRow(fallbackDate),
        scheduledDate: scheduledDate?.trim() || fallbackDate,
        scheduledTime:
          scheduledTime?.includes(":")
            ? scheduledTime.trim()
            : scheduledTime?.includes("午後")
              ? slotToScheduledTime("afternoon")
              : scheduledTime?.includes("午前")
                ? slotToScheduledTime("morning")
                : slotToScheduledTime("anytime"),
        title: title?.trim() || "",
        description: description?.trim() || "",
        priority: normalizeBatchPriority(priority ?? ""),
      };
    });
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
  if (priority === "urgent") return "🚨";
  if (priority === "high") return "🔴";
  if (priority === "medium") return "🟠";
  return "⚪️";
}

function formatTaskTitleIcon(task: TaskRecord) {
  if (task.status === "in_progress") return "🛠️";
  if (task.status === "awaiting_confirmation") return "👀";
  if (task.status === "done") return "✅";
  return formatPriorityIcon(task.priority);
}

function taskCardSurfaceClass(task: TaskRecord) {
  return task.status === "done" ? "bg-[#f3f4f6]" : "bg-[var(--chip)]";
}

function formatStatus(status: TaskRecord["status"]) {
  if (status === "pending") return "未着手";
  if (status === "in_progress") return "作業中";
  if (status === "awaiting_confirmation") return "確認待ち";
  if (status === "done") return "完了";
  return "スキップ";
}

function sortTasks(tasks: TaskRecord[]) {
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };

  return [...tasks].sort((a, b) => {
    const dateCmp = a.scheduled_date.localeCompare(b.scheduled_date);
    if (dateCmp !== 0) return dateCmp;

    const aIsActiveUrgent = a.priority === "urgent" && a.status !== "done";
    const bIsActiveUrgent = b.priority === "urgent" && b.status !== "done";

    if (aIsActiveUrgent && !bIsActiveUrgent) return -1;
    if (!aIsActiveUrgent && bIsActiveUrgent) return 1;
    if (aIsActiveUrgent && bIsActiveUrgent) {
      return (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");
    }

    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    return (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");
  });
}

function logMessage(log: TaskLogRecord) {
  const title = log.task?.title ?? "タスク";
  const beforeStatus =
    log.before_value &&
    typeof log.before_value === "object" &&
    "status" in log.before_value &&
    typeof log.before_value.status === "string"
      ? log.before_value.status
      : null;

  if (log.action_type === "started") {
    return beforeStatus === "done"
      ? `「${title}」を再開しました`
      : `「${title}」を開始しました`;
  }
  if (log.action_type === "completed") return `「${title}」を完了にしました`;
  if (log.action_type === "confirm_requested") return `「${title}」を確認して完了にしました`;
  if (log.action_type === "status_changed") return `「${title}」を中断しました`;
  if (log.action_type === "postponed_to_next_day") {
    return `「${title}」を翌日に回しました`;
  }
  if (log.action_type === "priority_changed") {
    return `「${title}」の優先度を変更しました`;
  }
  if (log.action_type === "member_joined") {
    const name = log.after_value?.memberName ?? "";
    return `${name}さんが参加しました`;
  }
  if (log.action_type === "member_removed") {
    const name = log.after_value?.memberName ?? "";
    return `${name}さんが削除されました`;
  }
  if (log.action_type === "created") return `「${title}」を作成しました`;
  return `「${title}」を更新しました`;
}

function isTaskLinkedLog(log: TaskLogRecord) {
  return log.action_type !== "member_joined" && log.action_type !== "member_removed";
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

function actorInitial(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
}

export function TaskBoard({
  appVersion,
  commitSha,
  authError,
  authSuccess,
  loginAttempt,
  sessionUser,
  initialState,
  inviteToken,
}: {
  appVersion: string;
  commitSha: string;
  authError: string | null;
  authSuccess: boolean;
  loginAttempt: string | null;
  sessionUser: SessionUser;
  initialState: AppState;
  inviteToken: string | null;
}) {
  const [state, setState] = useState(initialState);
  const [currentSessionUser, setCurrentSessionUser] = useState(sessionUser);
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
    currentSessionUser?.displayName ??
    "";
  const [activeInviteToken, setActiveInviteToken] = useState(inviteToken);
  const [screenMode, setScreenMode] = useState<ScreenMode>("home");
  const [currentGroupId, setCurrentGroupId] = useState(() => initialState.groups[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lineLoginPending, setLineLoginPending] = useState(false);
  const [lineLoginConsuming, setLineLoginConsuming] = useState(false);
  const [lineLoginCompleted, setLineLoginCompleted] = useState(false);
  const [taskSavePending, setTaskSavePending] = useState(false);
  const [taskActionPending, setTaskActionPending] = useState<ActionType | null>(null);
  const [taskDeletePendingId, setTaskDeletePendingId] = useState<string | null>(null);
  const [deleteConfirmTaskId, setDeleteConfirmTaskId] = useState<string | null>(null);
  const [approvalPendingId, setApprovalPendingId] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<{ id: string; name: string } | null>(null);
  const [removeMemberPending, setRemoveMemberPending] = useState(false);
  const [workspaceSettingsPending, setWorkspaceSettingsPending] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editUpdateScope, setEditUpdateScope] = useState<"single" | "all">("single");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [copySourceTaskId, setCopySourceTaskId] = useState<string>("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [openNotificationId, setOpenNotificationId] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<BatchTaskRow[]>(() =>
    Array.from({ length: 8 }, () => createBatchTaskRow()),
  );
  const [batchPasteValue, setBatchPasteValue] = useState("");
  const [bootstrapForm, setBootstrapForm] = useState({
    workspaceName: "",
    groupName: "",
    displayName: currentSessionUser?.displayName ?? "",
  });
  const [requestName, setRequestName] = useState("");
  const [taskForm, setTaskForm] = useState<TaskFormState>(createDefaultTaskForm);
  const [notificationTime, setNotificationTime] = useState(
    initialState.workspace?.notification_time?.slice(0, 5) ?? "08:00",
  );
  const [notificationTime2, setNotificationTime2] = useState(
    initialState.workspace?.notification_time_2?.slice(0, 5) ?? "",
  );
  const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);
  const [pushSetupNotice, setPushSetupNotice] = useState<PushSetupNotice | null>(null);
  const [devicePermissionNotice, setDevicePermissionNotice] = useState<DevicePermissionNotice | null>(null);
  const [pendingReferenceFiles, setPendingReferenceFiles] = useState<File[]>([]);
  const [homeDate, setHomeDate] = useState(getDateStringWithOffset(0));
  const [homeDateMotion, setHomeDateMotion] = useState<"prev" | "next" | "reset">("reset");
  const [homeDateMotionKey, setHomeDateMotionKey] = useState(0);
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
  const [isIosLike] = useState(() => {
    if (typeof window === "undefined") return false;

    const ua = window.navigator.userAgent;
    const iOSDevice = /iPhone|iPad|iPod/i.test(ua);
    const iPadOnMac = /Macintosh/i.test(ua) && "ontouchend" in document;
    return iOSDevice || iPadOnMac;
  });
  const [isAndroid] = useState(() => {
    if (typeof window === "undefined") return false;
    return /Android/i.test(window.navigator.userAgent);
  });
  const [isLineInAppBrowser] = useState(() => {
    if (typeof window === "undefined") return false;
    return /Line\//i.test(window.navigator.userAgent);
  });
  const isMobile = isIosLike || isAndroid;
  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const activeGroupId = state.groups.some((group) => group.id === currentGroupId)
    ? currentGroupId
    : (state.groups[0]?.id ?? "");
  const todayDate = getDateStringWithOffset(0);
  const homeDateOffset =
    Math.round(
      (new Date(`${homeDate}T00:00:00`).getTime() - new Date(`${todayDate}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000),
    ) || 0;

  const sortedTasks = useMemo(
    () =>
      sortTasks(
        state.tasks.filter((task) => {
          if (task.deleted_at) return false;
          if (activeGroupId && task.group_id !== activeGroupId) return false;
          return task.scheduled_date === homeDate;
        }),
      ),
    [activeGroupId, homeDate, state.tasks],
  );

  const rangedTasks = useMemo(() => {
    const filtered = state.tasks.filter((task) => {
      if (task.deleted_at) return false;
      if (task.group_id !== activeGroupId) return false;
      return task.scheduled_date >= rangeStart && task.scheduled_date <= rangeEnd;
    });

    // 同じ繰り返しルールのタスクは直近1件（今日以降で最も近い日、なければ最新の過去日）に集約
    const recurGroups = new Map<string, TaskRecord[]>();
    const nonRecurring: TaskRecord[] = [];
    for (const task of filtered) {
      if (task.recurrence_rule_id) {
        const group = recurGroups.get(task.recurrence_rule_id) ?? [];
        group.push(task);
        recurGroups.set(task.recurrence_rule_id, group);
      } else {
        nonRecurring.push(task);
      }
    }

    const representatives: TaskRecord[] = [];
    for (const group of recurGroups.values()) {
      const sorted = [...group].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
      const upcoming = sorted.filter((t) => t.scheduled_date >= todayDate);
      representatives.push(upcoming.length > 0 ? upcoming[0] : sorted[sorted.length - 1]);
    }

    return sortTasks([...nonRecurring, ...representatives]);
  }, [activeGroupId, rangeEnd, rangeStart, state.tasks, todayDate]);

  const counts = useMemo(
    () => ({
      pending: state.tasks.filter(
        (task) =>
          !task.deleted_at &&
          task.group_id === activeGroupId &&
          task.scheduled_date === homeDate &&
          task.status === "pending",
      ).length,
      inProgress: state.tasks.filter(
        (task) =>
          !task.deleted_at &&
          task.group_id === activeGroupId &&
          task.scheduled_date === homeDate &&
          task.status === "in_progress",
      ).length,
      awaitingConfirmation: state.tasks.filter(
        (task) =>
          !task.deleted_at &&
          task.group_id === activeGroupId &&
          task.scheduled_date === homeDate &&
          task.status === "awaiting_confirmation",
      ).length,
      done: state.tasks.filter(
        (task) =>
          !task.deleted_at &&
          task.group_id === activeGroupId &&
          task.scheduled_date === homeDate &&
          task.status === "done",
      ).length,
    }),
    [activeGroupId, homeDate, state.tasks],
  );
  const selectedTask =
    selectedTaskId ? state.tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const latestLog = state.logs[0] ?? null;
  const olderLogs = state.logs.slice(1);
  const currentGroup = state.groups.find((group) => group.id === activeGroupId) ?? null;
  const isProcessing =
    isSubmitting ||
    lineLoginPending ||
    lineLoginConsuming ||
    !!taskActionPending ||
    !!taskDeletePendingId ||
    !!approvalPendingId ||
    removeMemberPending;
  const lastVersionCheckAtRef = useRef(0);
  const refreshAppStateRef = useRef<(() => Promise<boolean>) | null>(null);
  const lineLoginSyncingRef = useRef(false);
  const consumedLoginAttemptRef = useRef<string | null>(null);
  const effectiveSessionUser = useMemo(
    () =>
      currentSessionUser ??
      (state.sessionLineUserId
        ? {
            lineUserId: state.sessionLineUserId,
            displayName: state.appUser?.display_name ?? null,
            pictureUrl: state.appUser?.line_picture_url ?? null,
          }
        : null),
    [currentSessionUser, state.appUser?.display_name, state.appUser?.line_picture_url, state.sessionLineUserId],
  );

  function pushToast(tone: Toast["tone"], message: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }

  function moveHomeDate(days: number) {
    setHomeDate((current) => shiftDateString(current, days));
    setHomeDateMotion(days < 0 ? "prev" : "next");
    setHomeDateMotionKey((current) => current + 1);
  }

  function resetHomeDateToToday() {
    setHomeDate(getDateStringWithOffset(0));
    setHomeDateMotion("reset");
    setHomeDateMotionKey((current) => current + 1);
  }

  async function callJson(url: string, init?: RequestInit) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: init?.cache ?? "no-store",
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

  const beginLineLogin = useCallback(async () => {
    setLineLoginPending(true);
    const result = await callJson("/api/auth/line/start", {
      method: "POST",
    });

    if (!result.ok || !result.json || typeof result.json !== "object") {
      setLineLoginPending(false);
      pushToast("error", "LINEログインを開始できませんでした。");
      return;
    }

    const attemptId =
      "attemptId" in result.json && typeof result.json.attemptId === "string"
        ? result.json.attemptId
        : null;
    const authorizeUrl =
      "authorizeUrl" in result.json && typeof result.json.authorizeUrl === "string"
        ? result.json.authorizeUrl
        : null;

    if (!attemptId || !authorizeUrl) {
      pushToast("error", "LINEログイン情報が不正です。");
      return;
    }

    window.localStorage.setItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY, attemptId);
    if (activeInviteToken) {
      window.localStorage.setItem(PENDING_INVITE_STORAGE_KEY, activeInviteToken);
    }
    window.location.href = authorizeUrl;
  }, [activeInviteToken]);

  const refreshAppState = useCallback(async () => {
    const inviteQuery = activeInviteToken ? `?invite=${encodeURIComponent(activeInviteToken)}` : "";
    const result = await callJson(`/api/app-state${inviteQuery}`);
    if (!result.ok || !result.json || typeof result.json !== "object" || !("state" in result.json)) {
      return false;
    }

    const nextState = (result.json as { state?: AppState }).state;
    if (!nextState) {
      return false;
    }

    setState(nextState);
    setCurrentSessionUser(
      nextState.sessionLineUserId
        ? {
            lineUserId: nextState.sessionLineUserId,
            displayName: nextState.appUser?.display_name ?? currentSessionUser?.displayName ?? null,
            pictureUrl: nextState.appUser?.line_picture_url ?? currentSessionUser?.pictureUrl ?? null,
          }
        : null,
    );
    return true;
  }, [currentSessionUser?.displayName, currentSessionUser?.pictureUrl, activeInviteToken]);

  refreshAppStateRef.current = refreshAppState;

  const syncLatestState = useCallback(async () => {
    const ok = await refreshAppState();
    if (!ok) {
      pushToast("error", "最新状態の再取得に失敗しました。");
    }
    return ok;
  }, [refreshAppState]);

  const consumePendingLineLogin = useCallback(async () => {
    if (lineLoginSyncingRef.current || typeof window === "undefined") {
      return false;
    }

    const attemptId =
      loginAttempt ?? window.localStorage.getItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY);
    if (!attemptId) {
      return false;
    }

    // Already processed in this session — skip silently
    if (consumedLoginAttemptRef.current === attemptId) {
      return false;
    }

    lineLoginSyncingRef.current = true;
    setLineLoginConsuming(true);

    try {
      if (loginAttempt) {
        window.localStorage.setItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY, loginAttempt);
      }

      const statusResult = await callJson(
        `/api/auth/line/status?attemptId=${encodeURIComponent(attemptId)}`,
        {
          cache: "no-store",
        },
      );

      if (!statusResult.ok || !statusResult.json || typeof statusResult.json !== "object") {
        return false;
      }

      const status = "status" in statusResult.json ? statusResult.json.status : null;
      if (status === "pending") {
        return false;
      }

      if (status === "expired" || status === "failed" || status === "not_found") {
        window.localStorage.removeItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY);
        consumedLoginAttemptRef.current = attemptId;
        pushToast("error", "LINEログインを完了できませんでした。もう一度お試しください。");
        return false;
      }

      // "completed" = first consumer, "consumed" = already consumed by another context (e.g. browser)
      // Both cases call consume so this context (e.g. PWA) gets its own session cookie.
      const consumeResult = await callJson("/api/auth/line/consume", {
        method: "POST",
        body: JSON.stringify({ attemptId }),
      });

      if (!consumeResult.ok) {
        return false;
      }

      window.localStorage.removeItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY);
      consumedLoginAttemptRef.current = attemptId;

      const pendingInvite = window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY);
      if (pendingInvite) {
        window.localStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
        window.location.href = `/?invite=${encodeURIComponent(pendingInvite)}`;
        return true;
      }

      await refreshAppState();
      setLineLoginCompleted(true);
      if (status === "completed") {
        pushToast("success", "LINEログインが完了しました。");
      }
      return true;
    } finally {
      lineLoginSyncingRef.current = false;
      setLineLoginConsuming(false);
    }
  }, [loginAttempt, refreshAppState]);

  const ensureLatestBuild = useCallback(async () => {
    const now = Date.now();
    if (now - lastVersionCheckAtRef.current < 5000) {
      return;
    }
    lastVersionCheckAtRef.current = now;

    const result = await callJson(`/api/version?ts=${now}`, {
      cache: "no-store",
    });
    if (!result.ok || !result.json || typeof result.json !== "object") {
      return;
    }

    const latest = result.json as { appVersion?: string; commitSha?: string };
    if (!latest.appVersion || !latest.commitSha) {
      return;
    }

    if (latest.appVersion === appVersion && latest.commitSha === commitSha) {
      window.sessionStorage.removeItem(VERSION_CHECK_STORAGE_KEY);
      return;
    }

    const mismatchKey = `${latest.appVersion}:${latest.commitSha}`;
    if (window.sessionStorage.getItem(VERSION_CHECK_STORAGE_KEY) === mismatchKey) {
      return;
    }
    window.sessionStorage.setItem(VERSION_CHECK_STORAGE_KEY, mismatchKey);
    pushToast("info", "最新版を適用するため再読み込みします。");

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update()));
    }

    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }

    window.setTimeout(() => {
      window.location.reload();
    }, 200);
  }, [appVersion, commitSha]);

  const ensurePushSubscriptionReady = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return false;
    }

    if (!("Notification" in window) || !("PushManager" in window)) {
      return false;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return false;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription =
      existingSubscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      }));

    const subscribeResult = await callJson("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        platform: /iPhone|iPad|iPod/i.test(window.navigator.userAgent)
          ? "ios"
          : /Android/i.test(window.navigator.userAgent)
            ? "android"
            : "web",
        deviceLabel: window.navigator.platform || "browser",
      }),
    });

    return subscribeResult.ok;
  }, []);

  const refreshPushSetupNotice = useCallback(async () => {
    if (typeof window === "undefined" || !effectiveSessionUser || !isPwaMode) {
      setPushSetupNotice(null);
      return;
    }

    if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      setPushSetupNotice(null);
      return;
    }

    if (Notification.permission === "denied") {
      setPushSetupNotice({
        tone: "error",
        message: "通知が拒否されています。iPhoneの設定 > 通知 > Team Task から通知を許可してください。",
      });
      return;
    }

    if (Notification.permission === "default") {
      setPushSetupNotice({
        tone: "info",
        message: "通知が未許可です。先に通知を許可しておくと、ロック中のPush通知を受け取れます。",
        actionLabel: "通知を許可",
        actionType: "request_permission",
      });
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setPushSetupNotice({
          tone: "info",
          message: "この端末の通知登録が未完了です。今のうちに登録しておくと、通知受信を確認できます。",
          actionLabel: "通知登録",
          actionType: "register_subscription",
        });
        return;
      }
    } catch {
      setPushSetupNotice({
        tone: "error",
        message: "通知の準備状態を確認できませんでした。PWAを開き直して再試行してください。",
      });
      return;
    }

    setPushSetupNotice(null);
  }, [effectiveSessionUser, isPwaMode]);

  const refreshDevicePermissionNotice = useCallback(async () => {
    if (typeof window === "undefined") return;

    const messages: string[] = [];

    if ("Notification" in window && Notification.permission === "denied") {
      messages.push("通知が拒否されています。");
    }

    try {
      const permissionsApi = navigator.permissions as PermissionStatus["state"] extends never
        ? never
        : Navigator["permissions"];

      if (permissionsApi?.query) {
        const cameraStatus = await permissionsApi.query({ name: "camera" as PermissionName });
        if (cameraStatus.state === "denied") {
          messages.push("カメラ権限が拒否されています。");
        }
      }
    } catch {}

    if (messages.length === 0) {
      setDevicePermissionNotice(null);
      return;
    }

    setDevicePermissionNotice({
      tone: "info",
      message: `${messages.join(" ")} 端末設定から許可してください。`,
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    void refreshDevicePermissionNotice();

    const handleResume = () => {
      if (document.visibilityState === "visible") {
        void refreshDevicePermissionNotice();
      }
    };

    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [refreshDevicePermissionNotice]);

  useEffect(() => {
    if (typeof window === "undefined" || activeInviteToken) {
      return;
    }

    const pendingInvite = window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (pendingInvite) {
      setActiveInviteToken(pendingInvite);
    }
  }, [activeInviteToken]);

  useEffect(() => {
    if (!authError) return;

    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.message !== authError));
    }, 3200);

    const url = new URL(window.location.href);
    if (!url.searchParams.has("authError")) return;

    url.searchParams.delete("authError");
    window.history.replaceState({}, "", url.toString());

    return () => {
      window.clearTimeout(timer);
    };
  }, [authError]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (loginAttempt) {
      window.localStorage.setItem(LINE_LOGIN_ATTEMPT_STORAGE_KEY, loginAttempt);
    }

    const url = new URL(window.location.href);
    let changed = false;
    ["authSuccess", "loginAttempt"].forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });

    if (changed) {
      window.history.replaceState({}, "", url.toString());
    }

    void consumePendingLineLogin();
  }, [consumePendingLineLogin, loginAttempt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void ensureLatestBuild();
      void consumePendingLineLogin();
      void refreshPushSetupNotice();
      void refreshAppState();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [consumePendingLineLogin, ensureLatestBuild, refreshAppState, refreshPushSetupNotice]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void ensureLatestBuild();
        void consumePendingLineLogin();
        void refreshPushSetupNotice();
        void refreshAppState();
      }
    };

    const handleFocus = () => {
      void ensureLatestBuild();
      void consumePendingLineLogin();
      void refreshPushSetupNotice();
      void refreshAppState();
    };

    const handlePageShow = () => {
      void ensureLatestBuild();
      void consumePendingLineLogin();
      void refreshPushSetupNotice();
      void refreshAppState();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [consumePendingLineLogin, ensureLatestBuild, refreshAppState, refreshPushSetupNotice]);

  useEffect(() => {
    if (typeof window === "undefined" || !state.workspace?.id || !effectiveSessionUser) {
      return;
    }

    let running = false;

    const tick = async () => {
      if (document.hidden || running) {
        return;
      }

      running = true;
      try {
        await refreshAppState();
      } finally {
        running = false;
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [effectiveSessionUser, refreshAppState, state.workspace?.id]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      pushToast("success", "オンラインに復帰しました。");

      void consumePendingLineLogin();
      void refreshAppState();
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
  }, [consumePendingLineLogin, queue.length, refreshAppState]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
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
        await refreshAppState();
      }
    }

    void flushQueue();

    return () => {
      cancelled = true;
    };
  }, [isOnline, queue, refreshAppState]);

  useEffect(() => {
    if (!state.pendingOwnRequest || !effectiveSessionUser) return;

    const interval = window.setInterval(() => {
      void refreshAppStateRef.current?.();
    }, 3000);

    return () => window.clearInterval(interval);
    // refreshAppStateRef is a stable ref — intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state.pendingOwnRequest, effectiveSessionUser]);

  useEffect(() => {
    if (state.appUser?.role !== "admin" || !state.workspace?.id) return;

    const interval = window.setInterval(() => {
      void refreshAppStateRef.current?.();
    }, 30000);

    return () => window.clearInterval(interval);
    // refreshAppStateRef is a stable ref — intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.appUser?.role, state.workspace?.id]);

  useEffect(() => {
    if (!state.workspace?.id || !effectiveSessionUser) return;

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    let refreshTimer: number | null = null;

    const refreshState = async () => {
      if (cancelled) return;

      const ok = await refreshAppStateRef.current?.();
      if (cancelled || !ok) {
        return;
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        void refreshState();
      }, 350);
    };

    const channel = supabase
      .channel(`workspace-${state.workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `workspace_id=eq.${state.workspace.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_activity_logs",
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_photos",
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_reference_photos",
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "membership_requests",
        },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      void supabase.removeChannel(channel);
    };
    // refreshAppStateRef is a stable ref; effectiveSessionUser and inviteToken
    // intentionally excluded — workspace presence is the only meaningful signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspace?.id]);

  async function handleLogout() {
    setIsSubmitting(true);
    const result = await callJson("/api/auth/logout", { method: "POST" });
    setIsSubmitting(false);

    if (!result.ok) {
      pushToast("error", "ログアウトに失敗しました。");
      return;
    }

    window.location.reload();
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

    await refreshAppState();
  }

  async function handleInstallPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  }

  async function handleMembershipRequest() {
    if (!activeInviteToken || !requestName.trim()) {
      pushToast("error", "名前を入力してください。");
      return;
    }

    setIsSubmitting(true);
    const result = await callJson("/api/membership-requests", {
      method: "POST",
      body: JSON.stringify({
        inviteToken: activeInviteToken,
        requestedName: requestName.trim(),
      }),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      pushToast("error", "登録申請に失敗しました。");
      return;
    }

    pushToast("success", "登録申請を送信しました。管理者の承認をお待ちください。");

    setActiveInviteToken(null);
    window.localStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());

    await refreshAppState();
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
    setApprovalPendingId(requestId);
    const result = await callJson(`/api/membership-requests/${requestId}/approve`, {
      method: "POST",
    });
    setApprovalPendingId(null);
    if (!result.ok) {
      pushToast("error", "承認に失敗しました。");
      return;
    }

    pushToast("success", "申請を承認しました。");
    await refreshAppState();
  }

  async function handleRejectRequest(requestId: string) {
    setApprovalPendingId(requestId);
    const result = await callJson(`/api/membership-requests/${requestId}/reject`, {
      method: "POST",
    });
    setApprovalPendingId(null);
    if (!result.ok) {
      pushToast("error", "却下に失敗しました。");
      return;
    }

    pushToast("success", "申請を却下しました。");
    await refreshAppState();
  }

  async function confirmRemoveMember() {
    if (!memberToDelete) return;
    setRemoveMemberPending(true);
    const result = await callJson(`/api/members/${memberToDelete.id}`, { method: "DELETE" });
    setRemoveMemberPending(false);
    setMemberToDelete(null);
    if (!result.ok) {
      pushToast("error", "メンバー削除に失敗しました。");
      return;
    }

    pushToast("success", "メンバーを削除しました。履歴は保持されます。");
    await refreshAppState();
  }

  async function handleLeaveCurrentGroup() {
    if (!currentGroup) {
      pushToast("error", "退出するグループが見つかりません。");
      return;
    }

    const confirmed = window.confirm(`「${currentGroup.name}」から退出しますか？`);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    const result = await callJson(`/api/groups/${currentGroup.id}/leave`, {
      method: "POST",
    });
    setIsSubmitting(false);

    if (!result.ok) {
      const error =
        result.json && typeof result.json === "object" && "error" in result.json
          ? String(result.json.error)
          : "";

      if (error === "LAST_ADMIN_CANNOT_LEAVE") {
        pushToast("error", "最後の管理者はグループから退出できません。");
        return;
      }

      if (error === "MEMBERSHIP_NOT_FOUND") {
        pushToast("error", "このグループには所属していません。");
        return;
      }

      pushToast("error", "グループ退出に失敗しました。");
      return;
    }

    pushToast("success", `「${currentGroup.name}」から退出しました。`);
    await refreshAppState();
  }

  async function handleSaveWorkspaceSettings() {
    setWorkspaceSettingsPending(true);
    const result = await callJson("/api/workspace/settings", {
      method: "PATCH",
      body: JSON.stringify({
        notificationTime,
        notificationTime2: notificationTime2 || null,
      }),
    });
    setWorkspaceSettingsPending(false);

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
    pushToast("success", "通知時刻を更新しました。");
  }

  async function handlePushSetupAction() {
    if (!pushSetupNotice?.actionType) {
      return;
    }

    if (pushSetupNotice.actionType === "request_permission") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        pushToast("error", "通知が許可されていません。");
        await refreshPushSetupNotice();
        return;
      }
    }

    try {
      const ok = await ensurePushSubscriptionReady();
      if (!ok) {
        pushToast("error", "通知端末の登録に失敗しました。");
        await refreshPushSetupNotice();
        return;
      }

      pushToast("success", "通知の準備が完了しました。");
      await refreshPushSetupNotice();
    } catch {
      pushToast("error", "通知の準備に失敗しました。");
      await refreshPushSetupNotice();
    }
  }

  async function handleSendDelayedTestNotification() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      pushToast("error", "この端末ではWeb通知を利用できません。");
      return;
    }

    if (!isPwaMode) {
      pushToast("info", "通知テストはホーム画面に追加したPWAから実行してください。");
      return;
    }

    if (!("Notification" in window) || !("PushManager" in window)) {
      pushToast("error", "この端末ではPush通知を利用できません。");
      return;
    }

    if (Notification.permission === "denied") {
      pushToast(
        "error",
        "通知が拒否されています。iPhoneの設定 > 通知 > Team Task から通知を許可してください。",
      );
      return;
    }

    if (Notification.permission === "default") {
      pushToast("info", "通知許可ダイアログを表示します。許可後にもう一度お試しください。");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        pushToast("error", "通知が許可されていません。通知テストを実行できません。");
        return;
      }
    }

    try {
      const ok = await ensurePushSubscriptionReady();
      if (!ok) {
        pushToast("error", "通知端末の登録に失敗しました。");
        return;
      }
    } catch {
      pushToast("error", "通知の準備に失敗しました。PWAで開き直して再試行してください。");
      return;
    }

    setIsSendingTestNotification(true);
    pushToast("info", "10秒後にテスト通知を送ります。端末をスリープして確認してください。");

    const result = await callJson("/api/push/test", {
      method: "POST",
      body: JSON.stringify({ delaySeconds: 10 }),
    });

    setIsSendingTestNotification(false);

    if (!result.ok) {
      const errorCode =
        result.json && typeof result.json === "object" && "error" in result.json
          ? result.json.error
          : null;
      pushToast(
        "error",
        errorCode === "NO_ACTIVE_SUBSCRIPTION"
          ? "この端末の通知登録が見つかりません。PWAで通知許可を確認してください。"
          : "テスト通知の送信に失敗しました。",
      );
      return;
    }

    pushToast("success", "テスト通知を送信しました。");
  }

  async function handleDismissLog(logId: string) {
    const previousLogs = state.logs;
    setOpenNotificationId(null);
    setState((current) => ({
      ...current,
      logs: current.logs.filter((log) => log.id !== logId),
    }));

    const result = await callJson(`/api/logs/${logId}/dismiss`, {
      method: "POST",
    });

    if (!result.ok) {
      setState((current) => ({ ...current, logs: previousLogs }));
      pushToast("error", "通知の削除に失敗しました。");
      return;
    }

    pushToast("success", "通知を削除しました。");
  }

  function openEditTask(task: TaskRecord) {
    setEditingTaskId(task.id);
    setEditUpdateScope("single");
    setCopySourceTaskId("");
    setPendingReferenceFiles([]);
    setTaskForm({
      ...buildTaskFormFromTask(task),
    });
    setCreateTaskOpen(true);
  }

  function openCreateTask() {
    setEditingTaskId(null);
    setCopySourceTaskId("");
    setPendingReferenceFiles([]);
    setTaskForm(createDefaultTaskForm());
    setCreateTaskOpen(true);
  }

  function openTaskDetail(task: TaskRecord) {
    setSelectedTaskId(task.id);
  }

  function openTaskFromLog(log: TaskLogRecord) {
    const directTask = log.task?.id
      ? state.tasks.find((item) => item.id === log.task?.id)
      : null;
    if (directTask) {
      openTaskDetail(directTask);
      return;
    }

    const recurrenceRuleId =
      log.after_value?.recurrence_rule_id ?? log.before_value?.recurrence_rule_id ?? null;
    const scheduledDate =
      log.after_value?.scheduled_date ?? log.before_value?.scheduled_date ?? null;
    const title = log.task?.title ?? log.after_value?.title ?? log.before_value?.title ?? null;

    const task =
      (recurrenceRuleId && scheduledDate
        ? state.tasks.find(
            (item) =>
              item.recurrence_rule_id === recurrenceRuleId &&
              item.scheduled_date === scheduledDate,
          )
        : null) ??
      (recurrenceRuleId
        ? state.tasks.find(
            (item) =>
              item.recurrence_rule_id === recurrenceRuleId &&
              (!title || item.title === title),
          )
        : null) ??
      (scheduledDate && title
        ? state.tasks.find(
            (item) => item.scheduled_date === scheduledDate && item.title === title,
          )
        : null) ??
      (title
        ? [...state.tasks]
            .filter((item) => item.title === title)
            .sort((a, b) => {
              const baseTime = new Date(log.created_at).getTime();
              const aTime = new Date(`${a.scheduled_date}T00:00:00`).getTime();
              const bTime = new Date(`${b.scheduled_date}T00:00:00`).getTime();
              return Math.abs(aTime - baseTime) - Math.abs(bTime - baseTime);
            })[0] ?? null
        : null);

    if (task) {
      openTaskDetail(task);
      return;
    }

    pushToast("error", "通知に対応するタスクが見つかりません。");
  }

  function updateBatchRow(rowId: string, patch: Partial<BatchTaskRow>) {
    setBatchRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  function appendBatchRows(count = 5) {
    setBatchRows((current) => [
      ...current,
      ...Array.from({ length: count }, () => createBatchTaskRow(homeDate)),
    ]);
  }

  function removeEmptyBatchRows() {
    setBatchRows((current) => {
      const filtered = current.filter(
        (row) =>
          row.title.trim() ||
          row.description.trim() ||
          row.scheduledTime !== slotToScheduledTime("morning") ||
          row.priority !== "medium" ||
          row.recurrenceEnabled ||
          row.pendingReferenceFiles.length > 0,
      );
      return filtered.length > 0 ? filtered : [createBatchTaskRow(homeDate)];
    });
  }

  function applyBatchPaste() {
    const parsedRows = parseBatchTaskRows(batchPasteValue, homeDate).filter((row) => row.title.trim());
    if (parsedRows.length === 0) {
      pushToast("error", "貼り付けデータにタイトル列がありません。");
      return;
    }

    setBatchRows(parsedRows);
    pushToast("success", `${parsedRows.length}件の行を読み込みました。`);
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
      groupId: activeGroupId,
      recurrence: {
        enabled: taskForm.recurrenceEnabled,
        frequency: taskForm.recurrenceFrequency,
        interval: taskForm.recurrenceInterval,
        endDate: taskForm.recurrenceEndDate,
        daysOfWeek: taskForm.recurrenceDaysOfWeek,
        dayOfMonth: taskForm.recurrenceDayOfMonth,
      },
    };

    setTaskSavePending(true);
    const result = editingTaskId
      ? await callJson(`/api/tasks/${editingTaskId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, updateScope: editUpdateScope }),
        })
      : await callJson("/api/tasks", {
          method: "POST",
          body: JSON.stringify(body),
        });
    setTaskSavePending(false);

    if (!result.ok) {
      pushToast("error", editingTaskId ? "タスク更新に失敗しました。" : "タスク作成に失敗しました。");
      return;
    }

    const taskId =
      editingTaskId ??
      (result.json &&
      typeof result.json === "object" &&
      "task" in result.json &&
      result.json.task &&
      typeof result.json.task === "object" &&
      "id" in result.json.task &&
      typeof result.json.task.id === "string"
        ? result.json.task.id
        : null);

    if (taskId && pendingReferenceFiles.length > 0) {
      // When bulk-editing all recurring siblings, upload once and link to each sibling
      const editingTask = editingTaskId ? state.tasks.find((t) => t.id === editingTaskId) : null;
      const siblingIds =
        editingTaskId && editUpdateScope === "all" && editingTask?.recurrence_rule_id
          ? state.tasks
              .filter(
                (t) =>
                  t.recurrence_rule_id === editingTask.recurrence_rule_id &&
                  t.id !== editingTaskId &&
                  !t.deleted_at,
              )
              .map((t) => t.id)
          : [];

      for (const file of pendingReferenceFiles.slice(0, 2)) {
        const photo = await handleReferencePhotoUpload(taskId, file);
        if (photo && siblingIds.length > 0) {
          for (const siblingId of siblingIds) {
            await handleReferencePhotoLink(siblingId, photo.id);
          }
        }
      }
    }

    pushToast("success", editingTaskId ? "タスクを更新しました。" : "タスクを作成しました。");
    setPendingReferenceFiles([]);
    setCreateTaskOpen(false);
    await syncLatestState();
  }

  async function handleBatchSaveTasks() {
    if (!state.workspace || !activeGroupId) {
      pushToast("error", "登録先グループが選択されていません。");
      return;
    }

    const rows = batchRows.filter((row) => row.title.trim());
    if (rows.length === 0) {
      pushToast("error", "登録するタスク行がありません。");
      return;
    }

    const invalidRowIndex = rows.findIndex(
      (row) =>
        row.recurrenceEnabled &&
        (!row.recurrenceEndDate ||
          row.recurrenceEndDate < row.scheduledDate ||
          (row.recurrenceFrequency === "weekly" && row.recurrenceDaysOfWeek.length === 0)),
    );
    if (invalidRowIndex >= 0) {
      pushToast("error", `行 ${invalidRowIndex + 1} の繰り返し設定を確認してください。`);
      return;
    }

    setIsSubmitting(true);
    const failures: number[] = [];

    for (const [index, row] of rows.entries()) {
      const result = await callJson("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          title: row.title.trim(),
          description: row.description.trim(),
          priority: row.priority,
          scheduledDate: row.scheduledDate,
          scheduledTime: row.scheduledTime || null,
          visibilityType: "group",
          groupId: activeGroupId,
          recurrence: {
            enabled: row.recurrenceEnabled,
            frequency: row.recurrenceFrequency,
            interval: row.recurrenceInterval,
            endDate: row.recurrenceEndDate,
            daysOfWeek: row.recurrenceDaysOfWeek,
            dayOfMonth: row.recurrenceDayOfMonth,
          },
        }),
      });

      if (!result.ok) {
        failures.push(index + 1);
        continue;
      }

      const json = result.json as { task?: { id?: string }; siblingTaskIds?: string[] } | null;
      const taskId = typeof json?.task?.id === "string" ? json.task.id : null;
      const siblingTaskIds: string[] = Array.isArray(json?.siblingTaskIds) ? (json.siblingTaskIds as string[]) : [];

      if (taskId && row.pendingReferenceFiles.length > 0) {
        for (const file of row.pendingReferenceFiles.slice(0, 2)) {
          const photo = await handleReferencePhotoUpload(taskId, file);
          // Share the same uploaded file to all sibling recurring tasks
          if (photo && siblingTaskIds.length > 0) {
            for (const siblingId of siblingTaskIds) {
              await handleReferencePhotoLink(siblingId, photo.id);
            }
          }
        }
      }
    }

    setIsSubmitting(false);

    if (failures.length > 0) {
      pushToast("error", `一括登録に失敗した行があります: ${failures.join(", ")}`);
      return;
    }

    pushToast("success", `${rows.length}件のタスクを一括登録しました。`);
    setBatchRows(Array.from({ length: 8 }, () => createBatchTaskRow(homeDate)));
    setBatchPasteValue("");
    setScreenMode("tasks");
    await syncLatestState();
  }

  async function handleDeleteTask(taskId: string, scope: "single" | "all" = "single") {
    setTaskDeletePendingId(taskId);
    setDeleteConfirmTaskId(null);
    const deletedTask = state.tasks.find((t) => t.id === taskId);
    const result = await callJson(`/api/tasks/${taskId}`, {
      method: "DELETE",
      body: JSON.stringify({ deleteScope: scope }),
    });
    setTaskDeletePendingId(null);
    if (!result.ok) {
      pushToast("error", "タスク削除に失敗しました。");
      return;
    }

    const ruleId = deletedTask?.recurrence_rule_id;
    if (scope === "all" && ruleId) {
      pushToast("success", "繰り返しタスクを全て削除しました。");
      setState((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.recurrence_rule_id !== ruleId),
      }));
    } else {
      pushToast("success", "タスクを削除しました。");
      setState((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId),
      }));
    }
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

  async function handleReferencePhotoUpload(taskId: string, file: File): Promise<TaskPhotoRecord | null> {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/tasks/${taskId}/reference-photos`, {
        method: "POST",
        body: formData,
      });
      const json = (await response.json().catch(() => null)) as
        | { photo?: TaskPhotoRecord }
        | { error?: string }
        | null;

      if (!response.ok || !json || !("photo" in json) || !json.photo) {
        pushToast("error", "説明画像の保存に失敗しました。");
        return null;
      }

      const createdPhoto = json.photo as TaskPhotoRecord;
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                reference_photos: [...(task.reference_photos ?? []), createdPhoto].slice(0, 2),
              }
            : task,
        ),
      }));
      pushToast("success", "説明画像を保存しました。");
      return createdPhoto;
    } catch {
      pushToast("error", "説明画像の保存に失敗しました。");
      return null;
    }
  }

  async function handleReferencePhotoLink(taskId: string, sourcePhotoId: string): Promise<void> {
    try {
      await fetch(`/api/tasks/${taskId}/reference-photos/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePhotoId }),
      });
    } catch {
      // silent — sibling linking is best-effort
    }
  }

  async function handleReferencePhotoDelete(taskId: string, photoId: string) {
    const result = await callJson(`/api/tasks/${taskId}/reference-photos/${photoId}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      pushToast("error", "説明画像の削除に失敗しました。");
      return;
    }

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              reference_photos: (task.reference_photos ?? []).filter((photo) => photo.id !== photoId),
            }
          : task,
      ),
    }));
    if (previewPhotoUrl) {
      const target = selectedTask?.reference_photos?.find((photo) => photo.id === photoId);
      if (target?.preview_url === previewPhotoUrl) {
        setPreviewPhotoUrl(null);
      }
    }
    pushToast("success", "説明画像を削除しました。");
  }

  async function handleReferencePhotoReplace(taskId: string, photoId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/tasks/${taskId}/reference-photos/${photoId}`, {
        method: "PATCH",
        body: formData,
      });
      const json = (await response.json().catch(() => null)) as
        | { photo?: TaskPhotoRecord }
        | { error?: string }
        | null;

      if (!response.ok || !json || !("photo" in json) || !json.photo) {
        pushToast("error", "説明画像の更新に失敗しました。");
        return;
      }

      const updatedPhoto = json.photo as TaskPhotoRecord;
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                reference_photos: (task.reference_photos ?? []).map((photo) =>
                  photo.id === photoId ? updatedPhoto : photo,
                ),
              }
            : task,
        ),
      }));
      pushToast("success", "説明画像を更新しました。");
    } catch {
      pushToast("error", "説明画像の更新に失敗しました。");
    }
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
    if (action === "postpone" && (task.priority === "urgent" || task.priority === "high")) {
      pushToast("error", "最優先タスクは翌日に回せません。");
      return;
    }

    const optimisticTasks = state.tasks.map((item) => {
      if (item.id !== task.id) return item;
      if (action === "start") return { ...item, status: "in_progress" as const };
      if (action === "confirm") return { ...item, status: "done" as const };
      if (action === "complete") return { ...item, status: "awaiting_confirmation" as const };
      if (action === "pause") return { ...item, status: "pending" as const };
      return item;
    });

    const optimisticLog: TaskLogRecord = {
      id: `temp-${Date.now()}`,
      action_type:
        action === "start"
        ? "started"
          : action === "confirm"
            ? "confirm_requested"
          : action === "complete"
            ? "completed"
            : action === "pause"
              ? "status_changed"
            : "postponed_to_next_day",
      created_at: new Date().toISOString(),
      actor: {
        display_name: memberName || effectiveSessionUser?.displayName || "誰か",
        line_picture_url:
          effectiveSessionUser?.pictureUrl ?? state.appUser?.line_picture_url ?? null,
      },
      task: { id: task.id, title: task.title },
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

    setTaskActionPending(action);
    const result = await callJson(`/api/tasks/${task.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    setTaskActionPending(null);

    if (!result.ok) {
      pushToast("error", "操作に失敗しました。通信状態を確認してください。");
      await syncLatestState();
      return;
    }

    pushToast(
      "success",
      action === "start"
        ? task.status === "done"
          ? `「${task.title}」を再開しました。`
          : `「${task.title}」を開始しました。`
        : action === "confirm"
          ? `「${task.title}」を確認して完了にしました。`
        : action === "complete"
          ? `「${task.title}」を完了にしました。`
          : action === "pause"
            ? `「${task.title}」を中断しました。`
            : `「${task.title}」を翌日に回しました。`,
    );

    const updatedTask = (result.json as { task?: TaskRecord } | null)?.task;
    if (updatedTask) {
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((t) => (t.id === task.id ? { ...t, ...updatedTask } : t)),
      }));
    } else {
      await syncLatestState();
    }
  }

  if (!state.authConfigured) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
        <Card title="Supabase未設定">
          <p className="text-sm text-[var(--muted)]">
            `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を `.env.local`
            に設定してください。
          </p>
        </Card>
      </Shell>
    );
  }

  if (isLineInAppBrowser) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
        <Card>
          <p className="text-sm font-semibold text-[var(--brand)]">
            外部ブラウザで開いてください
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            LINEアプリ内のブラウザではログインできません。
            {isIosLike
              ? "右下の「…」→「ブラウザで開く」を選択してください。"
              : "右上のメニュー→「外部ブラウザで開く」を選択してください。"}
          </p>
        </Card>
      </Shell>
    );
  }

  if (isMobile && !isPwaMode && !activeInviteToken) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            {lineLoginCompleted ? (
              <>
                <p className="text-base font-bold text-[var(--brand)]">ログインが完了しました</p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  このタブを閉じて、ホーム画面のアプリから起動してください。
                </p>
                <button
                  className="mt-5 w-full rounded-lg border border-[var(--border)] py-2.5 text-sm text-[var(--muted)]"
                  onClick={() => window.close()}
                  type="button"
                >
                  閉じる
                </button>
              </>
            ) : (
              <>
            <p className="text-base font-bold text-[var(--brand)]">
              ホーム画面から起動してください
            </p>
            {isIosLike ? (
              <ol className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted)]">
                <li>1. Safariで開く</li>
                <li>
                  2. 画面下部の共有ボタン（
                  <span className="font-semibold">□↑</span>
                  ）をタップ
                </li>
                <li>
                  3.「<span className="font-semibold">ホーム画面に追加</span>」を選択
                </li>
                <li>
                  4.「<span className="font-semibold">追加</span>」をタップ
                </li>
              </ol>
            ) : (
              <div className="mt-4">
                {installPrompt ? (
                  <button
                    className="w-full rounded-lg bg-[var(--brand)] py-2.5 text-sm font-semibold text-white"
                    onClick={() => void handleInstallPwa()}
                    type="button"
                  >
                    ホーム画面に追加
                  </button>
                ) : (
                  <div className="space-y-3 text-sm leading-6 text-[var(--muted)]">
                    <ol className="space-y-1">
                      <li>1. アドレスバー右端の<span className="font-semibold">インストールアイコン</span>をタップ</li>
                      <li>2. または Chromeメニュー（⋮）→「<span className="font-semibold">アプリをインストール</span>」</li>
                    </ol>
                    <p className="rounded-xl bg-[var(--chip)] px-3 py-2 text-xs leading-5">
                      アプリを削除した直後はChromeの制限でインストールが表示されないことがあります。その場合は Chrome設定 → プライバシーとセキュリティ → サイトの設定 → 保存されているデータ → このサイトを削除 → ページを再読み込みしてください。
                    </p>
                  </div>
                )}
              </div>
            )}
            <button
              className="mt-5 w-full rounded-lg border border-[var(--border)] py-2.5 text-sm text-[var(--muted)]"
              onClick={() => window.close()}
              type="button"
            >
              タブを閉じる
            </button>
              </>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  if (!effectiveSessionUser) {
    return (
      <LoginScreen
        appVersion={appVersion}
        commitSha={commitSha}
        authSuccess={authSuccess}
        onStartLineLogin={beginLineLogin}
        isLoading={lineLoginPending || lineLoginConsuming}
        toasts={toasts}
      />
    );
  }

  if (lineLoginConsuming) {
    return <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={true}>{null}</Shell>;
  }

  if (state.needsBootstrap) {
    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
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
        <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
          <Card title="承認待ち">
            <p className="text-sm leading-7 text-[var(--muted)]">
              登録申請を送信済みです。管理者の承認後に利用可能になります。
            </p>
            <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              申請名: {state.pendingOwnRequest.requested_name}
            </div>
            {isMobile && !isPwaMode ? (
              <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm leading-6 text-[var(--muted)]">
                承認後はホーム画面に追加したアプリから起動してください。
              </div>
            ) : null}
          </Card>
        </Shell>
      );
    }

    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
        <Card title="登録申請">
          {state.activeInvite || activeInviteToken ? (
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

  if (!state.workspace) {
    if (state.pendingOwnRequest) {
      return (
        <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
          <Card title="承認待ち">
            <p className="text-sm leading-7 text-[var(--muted)]">
              登録申請を送信済みです。管理者の承認後に利用可能になります。
            </p>
            <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              申請名: {state.pendingOwnRequest.requested_name}
            </div>
            {isMobile && !isPwaMode ? (
              <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm leading-6 text-[var(--muted)]">
                承認後はホーム画面に追加したアプリから起動してください。
              </div>
            ) : null}
          </Card>
        </Shell>
      );
    }

    return (
      <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isProcessing}>
        <Card title="所属グループがありません">
          {state.activeInvite || activeInviteToken ? (
            <>
              <p className="mb-4 text-sm leading-7 text-[var(--muted)]">
                招待リンクを確認しました。名前を入力して登録申請を送信してください。
              </p>
              <FormField label="登録名">
                <input
                  className={inputClass}
                  value={requestName}
                  onChange={(event) => setRequestName(event.target.value)}
                  placeholder={state.appUser.display_name}
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
              現在参加中のグループがありません。招待URLから再度参加申請してください。
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  const desktopScreenMode =
    screenMode === "tasks" || screenMode === "notifications" || screenMode === "bulk"
      ? screenMode
      : "home";
  const desktopPanelMode =
    createTaskOpen
      ? "create"
      : selectedTask
        ? "detail"
        : showManageModal
          ? "manage"
          : showGroupModal
            ? "group"
            : desktopScreenMode;

  return (
    <Shell
      appVersion={appVersion}
      commitSha={commitSha}
      toasts={toasts}
      enablePushPrompt
      wide
    >
      <div className="desktop-layout hidden lg:block">
        <aside className="fixed inset-y-0 left-0 z-10 flex w-[220px] flex-col overflow-y-auto border-r border-[#e2e8f0] bg-white">

          {/* App logo / name */}
          <div className="flex h-14 items-center gap-2.5 border-b border-[#e2e8f0] px-4 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#244234]">
              <span className="text-xs font-bold text-white">T</span>
            </div>
            <span className="text-sm font-semibold text-[var(--ink)]">Team Task</span>
          </div>

          {/* Workspace + group selector */}
          <div className="border-b border-[#e2e8f0] px-3 py-4 shrink-0">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Workspace</p>
            <p className="truncate px-1 text-sm font-semibold text-[var(--ink)]">{state.workspace?.name ?? "Workspace"}</p>
            <p className="mt-0.5 truncate px-1 text-xs text-[var(--muted)]">
              {state.appUser.display_name} · {state.appUser.role}
            </p>
            <select
              className="mt-2 w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] outline-none focus:border-[#244234]/40 focus:ring-2 focus:ring-[#244234]/10"
              value={activeGroupId}
              onChange={(event) => setCurrentGroupId(event.target.value)}
            >
              {state.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          {/* Primary nav */}
          <nav className="flex flex-col gap-1 px-2 pt-4 pb-2">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Menu</p>
            <button
              className={desktopPanelMode === "home" ? desktopNavActiveClass : desktopNavButtonClass}
              onClick={() => { setScreenMode("home"); setCreateTaskOpen(false); setSelectedTaskId(null); setShowManageModal(false); setShowGroupModal(false); }}
              type="button"
            >
              ダッシュボード
            </button>
            <button
              className={desktopPanelMode === "tasks" ? desktopNavActiveClass : desktopNavButtonClass}
              onClick={() => { setScreenMode("tasks"); setCreateTaskOpen(false); setSelectedTaskId(null); setShowManageModal(false); setShowGroupModal(false); }}
              type="button"
            >
              タスク一覧
            </button>
            <button
              className={desktopPanelMode === "bulk" ? desktopNavActiveClass : desktopNavButtonClass}
              onClick={() => { setScreenMode("bulk"); setCreateTaskOpen(false); setSelectedTaskId(null); setShowManageModal(false); setShowGroupModal(false); }}
              type="button"
            >
              一括登録
            </button>
            <button
              className={desktopPanelMode === "notifications" ? desktopNavActiveClass : desktopNavButtonClass}
              onClick={() => { setScreenMode("notifications"); setCreateTaskOpen(false); setSelectedTaskId(null); setShowManageModal(false); setShowGroupModal(false); }}
              type="button"
            >
              通知
            </button>
          </nav>

          {/* New task CTA + sub-nav */}
          <div className="flex flex-col gap-1 border-t border-[#e2e8f0] px-2 pt-4 pb-2">
            <div className="px-1 pb-3">
              <button
                className="w-full rounded-md bg-[#244234] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a3128] active:bg-[#15271f]"
                onClick={openCreateTask}
                type="button"
              >
                + 新規タスク
              </button>
            </div>
            {state.appUser.role === "admin" ? (
              <button className={desktopPanelMode === "manage" ? desktopNavActiveClass : desktopNavButtonClass} onClick={() => { setShowManageModal(true); setShowGroupModal(false); setCreateTaskOpen(false); setSelectedTaskId(null); }} type="button">
                管理
              </button>
            ) : null}
            <button className={desktopPanelMode === "group" ? desktopNavActiveClass : desktopNavButtonClass} onClick={() => { setShowGroupModal(true); setShowManageModal(false); setCreateTaskOpen(false); setSelectedTaskId(null); }} type="button" disabled={!currentGroup}>
              グループ詳細
            </button>
          </div>

          {/* Logout + version — pushed to bottom */}
          <div className="mt-auto flex flex-col gap-1 border-t border-[#e2e8f0] px-2 py-3">
            <button className={`${desktopDangerButtonClass} w-full justify-start`} onClick={handleLogout} type="button" disabled={isSubmitting}>
              {isSubmitting ? "処理中..." : "ログアウト"}
            </button>
            <p className="mt-2 px-2 text-xs text-[var(--muted)]">{appVersion} ({commitSha})</p>
          </div>

        </aside>

        <main className="ml-[220px] min-h-screen bg-[#f1f5f9] pl-10 pr-10">
          {desktopPanelMode === "home" ? (
            <div className="py-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.58fr)_minmax(300px,0.62fr)] xl:items-stretch">
              <div className="grid gap-5 self-start">
                <Card className="rounded-lg border border-[#e2e8f0] bg-white px-6 py-6 shadow-none">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]/70">
                        Task Board
                      </p>
                      <div
                        key={homeDateMotionKey}
                        className={`${
                          homeDateMotion === "prev"
                            ? "home-date-slide-prev"
                            : homeDateMotion === "next"
                              ? "home-date-slide-next"
                              : "home-date-slide-reset"
                        }`}
                      >
                        <h1 className="mt-2 font-[family-name:var(--font-heading)] text-[2.8rem] leading-none tracking-[-0.05em]">
                          {formatHomeHeadingDate(homeDate)}
                        </h1>
                        <p className="mt-2 text-sm font-medium text-[var(--muted)]">
                          {homeDateOffset === 0
                            ? "本日"
                            : homeDateOffset > 0
                              ? `${homeDateOffset}日後`
                              : `${Math.abs(homeDateOffset)}日前`}
                        </p>
                      </div>
                    </div>
                    {!isOnline || syncState !== "idle" ? (
                      <div className="min-w-[240px] rounded-2xl bg-[var(--chip)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                        {!isOnline
                          ? "圏外のため操作は端末に保留されます"
                          : syncState === "queued"
                            ? `保留 ${queue.length}件を同期待ちです`
                            : syncState === "syncing"
                              ? "保留中の操作を同期しています"
                              : "同期に失敗しました。通信状態を確認してください"}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 grid max-w-lg grid-cols-3 gap-2">
                    <button
                      className={homeDateOffset < 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                      onClick={() => moveHomeDate(-1)}
                      type="button"
                    >
                      前日
                    </button>
                    <button
                      className={homeDateOffset === 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                      onClick={resetHomeDateToToday}
                      type="button"
                    >
                      本日
                    </button>
                    <button
                      className={homeDateOffset > 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                      onClick={() => moveHomeDate(1)}
                      type="button"
                    >
                      翌日
                    </button>
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-3">
                    <SummaryCard label="未着手" value={counts.pending} tone="default" />
                    <SummaryCard label="作業中" value={counts.inProgress} tone="warning" />
                    <SummaryCard label="確認待ち" value={counts.awaitingConfirmation} tone="warning" />
                    <SummaryCard label="完了" value={counts.done} tone="success" />
                  </div>
                </Card>

                <Card className="rounded-lg border border-[#e2e8f0] bg-white px-6 py-6 shadow-none">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">本日のタスク</h2>
                    <button className={desktopSecondaryButtonClass} onClick={() => setScreenMode("tasks")} type="button">
                      一覧へ
                    </button>
                  </div>
                  {sortedTasks.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">今日のタスクはありません。</p>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
                      <div className="grid grid-cols-[minmax(0,1.5fr)_120px_120px_110px] bg-[#f8fafc] px-5 py-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                        <span>タスク</span>
                        <span>時間帯</span>
                        <span>状態</span>
                        <span>操作</span>
                      </div>
                      {sortedTasks.map((task) => (
                        <div
                          key={task.id}
                          className={`grid grid-cols-[minmax(0,1.5fr)_120px_120px_110px] items-center gap-4 border-t border-black/5 px-5 py-4 transition-colors hover:bg-black/[0.02] ${taskCardSurfaceClass(task)}`}
                        >
                          <button className="min-w-0 text-left" onClick={() => openTaskDetail(task)} type="button">
                            <p className="truncate text-sm font-semibold text-[var(--ink)]">
                              {formatTaskTitleIcon(task)}{" "}
                              {task.title}
                              {task.recurrence_rule_id && (
                                <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#244234] bg-[#d1fae5] align-middle">繰返</span>
                              )}
                            </p>
                          </button>
                          <span className="text-sm text-[var(--muted)]">{slotLabel(scheduledTimeToSlot(task.scheduled_time))}</span>
                          <span className={taskStatusChipClass(task.status)}>{formatStatus(task.status)}</span>
                          <button className={miniUtilityButtonClass} onClick={() => openTaskDetail(task)} type="button">
                            詳細
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="sticky top-6 grid gap-5" style={{ height: "calc(100vh - 3rem)" }}>
                <div className="overflow-hidden rounded-lg border border-[#e2e8f0] bg-white px-6 py-6 shadow-none" style={{ height: state.appUser.role === "admin" && state.pendingRequests.length > 0 ? "calc(100% - 88px)" : "100%" }}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">最新通知</h2>
                    <button
                      className="text-sm font-semibold text-[var(--brand)]"
                      onClick={() => setScreenMode("notifications")}
                      type="button"
                    >
                      全件を見る
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 overflow-y-auto pr-1" style={{ height: "calc(100% - 2.5rem)" }}>
                    {state.logs.length > 0 ? (
                      state.logs.map((log) => (
                      <NotificationBubble
                        key={log.id}
                        isOpen={openNotificationId === log.id}
                        log={log}
                        onClose={() => setOpenNotificationId(null)}
                        onDismiss={() => handleDismissLog(log.id)}
                        onOpen={() => setOpenNotificationId(log.id)}
                        onTaskClick={isTaskLinkedLog(log) ? () => openTaskFromLog(log) : undefined}
                      />
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted)]">通知はまだありません。</p>
                    )}
                  </div>
                </div>

                {state.appUser.role === "admin" && state.pendingRequests.length > 0 ? (
                  <Card className="self-end rounded-lg border border-[var(--danger)]/20 bg-[#fef2f2] shadow-none">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--danger)]">承認待ち申請があります</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {state.pendingRequests.length}件の申請が管理画面で承認待ちです。
                        </p>
                      </div>
                      <button className={secondaryButtonClass} onClick={() => setShowManageModal(true)} type="button">
                        確認
                      </button>
                    </div>
                  </Card>
                ) : null}

                {isPwaMode && pushSetupNotice ? (
                  <Card className="rounded-lg border border-[#e2e8f0] bg-white shadow-none">
                    <p className={`text-sm font-semibold ${pushSetupNotice.tone === "error" ? "text-[var(--danger)]" : "text-[var(--brand)]"}`}>
                      通知設定の案内
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{pushSetupNotice.message}</p>
                    {pushSetupNotice.actionLabel ? (
                      <button className="mt-3 inline-flex rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)]" onClick={handlePushSetupAction} type="button">
                        {pushSetupNotice.actionLabel}
                      </button>
                    ) : null}
                  </Card>
                ) : null}

                {devicePermissionNotice ? (
                  <Card className="rounded-lg border border-[#e2e8f0] bg-white shadow-none">
                    <p className="text-sm font-semibold text-[var(--brand)]">権限の案内</p>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{devicePermissionNotice.message}</p>
                  </Card>
                ) : null}
              </div>
            </div>
            </div>
          ) : null}

          {desktopPanelMode === "create" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <TaskModal
                currentGroupName={
                  state.groups.find((group) => group.id === activeGroupId)?.name ?? "グループ未設定"
                }
                availableCopyTasks={state.tasks.filter(
                  (task) => !task.deleted_at && task.group_id === activeGroupId,
                )}
                copySourceTaskId={copySourceTaskId}
                form={taskForm}
                isEditing={Boolean(editingTaskId)}
                isSaving={taskSavePending}
                pendingReferenceFiles={pendingReferenceFiles}
                onCopySourceChange={handleCopySourceChange}
                onClose={() => setCreateTaskOpen(false)}
                onSave={handleSaveTask}
                setPendingReferenceFiles={setPendingReferenceFiles}
                setForm={setTaskForm}
                hasRecurrenceRule={Boolean(editingTaskId && state.tasks.find((t) => t.id === editingTaskId)?.recurrence_rule_id)}
                updateScope={editUpdateScope}
                onUpdateScopeChange={setEditUpdateScope}
                inline
              />
            </Card>
          ) : null}

          {desktopPanelMode === "detail" && selectedTask ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <TaskDetailModal
                actionPending={taskActionPending}
                task={selectedTask}
                onClose={() => setSelectedTaskId(null)}
                onCopyText={copyText}
                onAction={(action) => void performTaskAction(selectedTask, action)}
                onReferencePhotoUpload={(file) => void handleReferencePhotoUpload(selectedTask.id, file)}
                onReferencePhotoDelete={(photoId) =>
                  void handleReferencePhotoDelete(selectedTask.id, photoId)
                }
                onReferencePhotoReplace={(photoId, file) =>
                  void handleReferencePhotoReplace(selectedTask.id, photoId, file)
                }
                onPhotoUpload={(file) => void handlePhotoUpload(selectedTask.id, file)}
                onPhotoDelete={(photoId) => void handlePhotoDelete(selectedTask.id, photoId)}
                onPhotoReplace={(photoId, file) => void handlePhotoReplace(selectedTask.id, photoId, file)}
                onPreview={(url) => setPreviewPhotoUrl(url)}
                inline
              />
            </Card>
          ) : null}

          {desktopPanelMode === "manage" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <div>
                <h3 className="font-[family-name:var(--font-heading)] text-2xl tracking-[-0.04em]">管理画面</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">メンバー承認・招待・設定</p>
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="grid gap-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">承認待ち申請</p>
                    <div className="mt-3">
                      {state.pendingRequests.length === 0 ? (
                        <p className="text-sm text-[var(--muted)]">承認待ちはありません。</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {state.pendingRequests.map((item) => (
                            <PendingRequestCard
                              key={item.id}
                              groups={state.groups}
                              item={item}
                              isPending={approvalPendingId === item.id}
                              onApprove={() => handleApproveRequest(item.id)}
                              onReject={() => handleRejectRequest(item.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">メンバー</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {state.members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-md border border-[#e2e8f0] bg-white px-3 py-2.5"
                        >
                          <div>
                            <p className="text-sm font-semibold">{member.display_name}</p>
                            <p className="text-xs text-[var(--muted)]">{member.role}</p>
                          </div>
                          {state.appUser?.role === "admin" ? (
                            <button
                              className="rounded-xl border border-[var(--danger)]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--danger)]"
                              onClick={() => setMemberToDelete({ id: member.id, name: member.display_name })}
                              type="button"
                            >
                              削除
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  {state.appUser?.role === "admin" ? (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">グループ招待</p>
                      <div className="mt-3 flex flex-col gap-3">
                        {state.groups.map((group) => (
                          <div key={group.id} className="rounded-md border border-[#e2e8f0] bg-white px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{group.name}</p>
                                <p className="text-xs text-[var(--muted)]">24時間有効</p>
                              </div>
                              <button
                                className={desktopSecondaryButtonClass}
                                onClick={() => handleCreateInvite(group.id)}
                                type="button"
                              >
                                招待リンク発行
                              </button>
                            </div>
                            {inviteLinks[group.id] ? (
                              <div className="mt-2 flex items-center gap-2">
                                <p className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 text-xs text-[var(--ink-soft)]">
                                  {inviteLinks[group.id]}
                                </p>
                                <button
                                  className={desktopSecondaryButtonClass}
                                  onClick={() => void copyText("招待リンク", inviteLinks[group.id])}
                                  type="button"
                                >
                                  コピー
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">通知設定</p>
                  <div className="mt-3 grid gap-3 rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                    <FormField label="朝通知時刻（タスクあり）">
                      <NativePickerField
                        type="time"
                        value={notificationTime}
                        onChange={(event) => setNotificationTime(event.target.value)}
                      />
                    </FormField>
                    <FormField label="夕方通知時刻（未完了リマインド）">
                      <NativePickerField
                        type="time"
                        value={notificationTime2}
                        onChange={(event) => setNotificationTime2(event.target.value)}
                      />
                    </FormField>
                    <p className="text-xs text-[var(--muted)]">
                      タイムゾーン: {state.workspace?.timezone ?? "Asia/Tokyo"}
                      {"　"}夕方通知は未完了タスクがある場合のみ送信
                    </p>
                    <button
                      className={primaryButtonClass}
                      onClick={handleSaveWorkspaceSettings}
                      type="button"
                      disabled={workspaceSettingsPending}
                    >
                      {workspaceSettingsPending ? "保存中..." : "通知時刻を保存"}
                    </button>
                    <button
                      className={desktopSecondaryButtonClass}
                      disabled={isSendingTestNotification}
                      onClick={handleSendDelayedTestNotification}
                      type="button"
                    >
                      {isSendingTestNotification ? "送信中..." : "10秒後にテスト通知"}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {desktopPanelMode === "group" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <h3 className="font-[family-name:var(--font-heading)] text-2xl tracking-[-0.04em]">グループ詳細</h3>
              <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
                <div className="rounded-md border border-[#e2e8f0] bg-white px-5 py-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">GROUP</p>
                  <p className="mt-2 font-[family-name:var(--font-heading)] text-2xl tracking-[-0.03em] text-[var(--ink)]">
                    {currentGroup?.name ?? "グループ未設定"}
                  </p>
                  {currentGroup?.description ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{currentGroup.description}</p>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--muted)]">グループ説明は設定されていません。</p>
                  )}
                </div>
                <div className="rounded-md border border-[var(--danger)]/20 bg-[#fef2f2] px-5 py-5">
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--danger)]/70">危険操作</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                    この操作を行うと、現在のグループから退出します。過去の履歴は残ります。
                  </p>
                  <button
                    className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--danger)]"
                    onClick={handleLeaveCurrentGroup}
                    type="button"
                    disabled={isSubmitting || !currentGroup}
                  >
                    {isSubmitting ? "処理中..." : "このグループから退出"}
                  </button>
                </div>
              </div>
            </Card>
          ) : null}

          {desktopPanelMode === "tasks" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-[family-name:var(--font-heading)] text-2xl tracking-[-0.04em]">タスク一覧</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">期間を指定してタスクを確認・編集します。</p>
                </div>
                <div className="flex gap-2">
                  <button className={desktopSecondaryButtonClass} onClick={() => setScreenMode("bulk")} type="button">
                    一括登録
                  </button>
                  <button className={desktopSecondaryButtonClass} onClick={openCreateTask} type="button">
                    追加
                  </button>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 xl:max-w-xl">
                <FormField label="開始日">
                  <NativePickerField type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                </FormField>
                <FormField label="終了日">
                  <NativePickerField type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                </FormField>
              </div>
              <div className="mt-5 overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
                <div className="grid grid-cols-[minmax(0,1.5fr)_120px_110px_110px_220px] bg-[#f8fafc] px-5 py-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                  <span>タイトル</span>
                  <span>日付</span>
                  <span>時間帯</span>
                  <span>状態</span>
                  <span>操作</span>
                </div>
                {rangedTasks.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-[var(--muted)]">対象タスクはありません。</div>
                ) : (
                  rangedTasks.map((task) => (
                    <div key={task.id} className={`grid grid-cols-[minmax(0,1.5fr)_120px_110px_110px_220px] items-center gap-4 border-t border-black/5 px-5 py-4 transition-colors hover:bg-black/[0.02] ${taskCardSurfaceClass(task)}`}>
                      <button className="min-w-0 text-left" onClick={() => openTaskDetail(task)} type="button">
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">
                          {formatTaskTitleIcon(task)}{" "}
                          {task.title}
                          {task.recurrence_rule_id && (
                            <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#244234] bg-[#d1fae5] align-middle">繰返</span>
                          )}
                        </p>
                      </button>
                      <span className="text-sm text-[var(--muted)]">{task.scheduled_date}</span>
                      <span className="text-sm text-[var(--muted)]">{slotLabel(scheduledTimeToSlot(task.scheduled_time))}</span>
                      <span className={taskStatusChipClass(task.status)}>{formatStatus(task.status)}</span>
                      <div className="flex flex-wrap gap-2">
                        <button className={miniUtilityButtonClass} onClick={() => openEditTask(task)} type="button">編集</button>
                        <button
                          className={miniUtilityButtonClass}
                          onClick={() => {
                            openCreateTask();
                            handleCopySourceChange(task.id);
                          }}
                          type="button"
                        >
                          コピー
                        </button>
                        {deleteConfirmTaskId === task.id ? (
                          <>
                            <button
                              className={miniDangerButtonClass}
                              onClick={() => handleDeleteTask(task.id, "single")}
                              disabled={taskDeletePendingId === task.id}
                              type="button"
                            >
                              {taskDeletePendingId === task.id ? "削除中..." : "この1件"}
                            </button>
                            {task.recurrence_rule_id && (
                              <button
                                className={miniDangerButtonClass}
                                onClick={() => handleDeleteTask(task.id, "all")}
                                disabled={taskDeletePendingId === task.id}
                                type="button"
                              >
                                全て削除
                              </button>
                            )}
                            <button
                              className={miniUtilityButtonClass}
                              onClick={() => setDeleteConfirmTaskId(null)}
                              type="button"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <button
                            className={miniDangerButtonClass}
                            onClick={() => setDeleteConfirmTaskId(task.id)}
                            disabled={taskDeletePendingId === task.id}
                            type="button"
                          >
                            {taskDeletePendingId === task.id ? "削除中" : "削除"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ) : null}

          {desktopPanelMode === "notifications" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-[family-name:var(--font-heading)] text-2xl tracking-[-0.04em]">通知一覧</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">直近7日分の通知を確認できます。</p>
                </div>
                <button className={desktopSecondaryButtonClass} onClick={() => setScreenMode("home")} type="button">
                  ダッシュボード
                </button>
              </div>
              <div className="mt-5 grid gap-3">
                {state.logs.length > 0 ? (
                  state.logs.map((log) => (
                    <NotificationBubble
                      key={log.id}
                      isOpen={openNotificationId === log.id}
                    log={log}
                    onClose={() => setOpenNotificationId(null)}
                    onDismiss={() => handleDismissLog(log.id)}
                    onOpen={() => setOpenNotificationId(log.id)}
                    onTaskClick={isTaskLinkedLog(log) ? () => openTaskFromLog(log) : undefined}
                  />
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">通知はまだありません。</p>
                )}
              </div>
            </Card>
          ) : null}

          {desktopPanelMode === "bulk" ? (
            <Card className="my-6 rounded-lg border border-[#e2e8f0] bg-white px-7 py-7 shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-[family-name:var(--font-heading)] text-2xl tracking-[-0.04em]">一括登録</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">PCでは複数カードを並べてまとめて入力できます。</p>
                </div>
                <button className={desktopSecondaryButtonClass} onClick={() => setScreenMode("tasks")} type="button">
                  タスク一覧へ
                </button>
              </div>
              <div className="mt-4 rounded-md border border-[#244234]/15 bg-[#f0fdf4] px-4 py-3 text-sm text-[var(--ink-soft)]">
                登録先グループ: {currentGroup?.name ?? "グループ未設定"}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={desktopSecondaryButtonClass} onClick={() => appendBatchRows(5)} type="button">行を5件追加</button>
                <button className={desktopSecondaryButtonClass} onClick={removeEmptyBatchRows} type="button">空行を整理</button>
                <button className={desktopSecondaryButtonClass} onClick={() => setBatchRows(Array.from({ length: 8 }, () => createBatchTaskRow(homeDate)))} type="button">行をリセット</button>
              </div>
              <div className="mt-5 grid gap-4">
                {batchRows.map((row, index) => (
                  <div key={row.id} className="rounded-md border border-[#e2e8f0] bg-white p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-sm font-bold text-[var(--ink-soft)]">
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold text-[var(--ink-soft)]">タスク入力</p>
                      </div>
                      <button
                        className={miniDangerButtonClass}
                        onClick={() =>
                          setBatchRows((current) =>
                            current.length <= 1 ? current : current.filter((item) => item.id !== row.id),
                          )
                        }
                        type="button"
                        disabled={batchRows.length <= 1}
                      >
                        削除
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 text-[13px] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                      <div className="grid gap-4">
                        <FormField label="タイトル">
                          <input
                            className={inputClass}
                            value={row.title}
                            placeholder="タスク名"
                            onChange={(event) => updateBatchRow(row.id, { title: event.target.value })}
                          />
                        </FormField>
                        <FormField label="説明">
                          <textarea
                            className={`${inputClass} min-h-28`}
                            value={row.description}
                            placeholder="説明"
                            onChange={(event) => updateBatchRow(row.id, { description: event.target.value })}
                          />
                        </FormField>
                        <div>
                          <p className="mb-2 text-sm text-[var(--muted)]">画像</p>
                          <div className="grid gap-3 lg:grid-cols-[140px_minmax(0,1fr)]">
                            <label className={`${secondaryButtonClass} inline-flex justify-center`}>
                              追加
                              <input
                                className="hidden"
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(event) => {
                                  const files = Array.from(event.currentTarget.files ?? []).filter((file) => file.type.startsWith("image/"));
                                  updateBatchRow(row.id, {
                                    pendingReferenceFiles: [...row.pendingReferenceFiles, ...files].slice(0, 2),
                                  });
                                  event.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <div className="grid min-h-[72px] gap-2 sm:grid-cols-2">
                              {row.pendingReferenceFiles.length > 0 ? row.pendingReferenceFiles.map((file, fileIndex) => (
                                <button
                                  key={`${row.id}-${file.name}-${fileIndex}-desktop`}
                                  className="overflow-hidden rounded-2xl bg-[var(--surface)] p-2 text-left"
                                  onClick={() => setPreviewPhotoUrl(URL.createObjectURL(file))}
                                  type="button"
                                >
                                  <div className="aspect-[4/3] overflow-hidden rounded-xl bg-white">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      alt={file.name}
                                      className="h-full w-full object-cover"
                                      src={URL.createObjectURL(file)}
                                    />
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <p className="min-w-0 truncate text-xs font-semibold text-[var(--ink-soft)]">{file.name}</p>
                                    <span
                                      className="shrink-0 text-xs font-semibold text-[var(--danger)]"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        updateBatchRow(row.id, {
                                          pendingReferenceFiles: row.pendingReferenceFiles.filter((_, indexValue) => indexValue !== fileIndex),
                                        });
                                      }}
                                    >
                                      削除
                                    </span>
                                  </div>
                                </button>
                              )) : <p className="text-xs text-[var(--muted)]">未追加</p>}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField label="実行日">
                            {!row.recurrenceEnabled ? (
                              <NativePickerField
                                type="date"
                                value={row.scheduledDate}
                                onChange={(event) => updateBatchRow(row.id, {
                                  scheduledDate: event.target.value,
                                  recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                                  recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                                })}
                              />
                            ) : (
                              <div className={`${inputClass} bg-[var(--surface)] text-[var(--muted)]`}>繰り返し時は未使用</div>
                            )}
                          </FormField>
                          <div>
                            <p className="mb-2 text-sm text-[var(--muted)]">時間帯</p>
                            <div className="grid grid-cols-3 gap-2">
                              {(["morning", "afternoon", "anytime"] as const).map((slot) => (
                                <button
                                  key={`${row.id}-${slot}-desktop`}
                                  className={selectedSlotButtonClass(scheduledTimeToSlot(row.scheduledTime) === slot)}
                                  onClick={() => updateBatchRow(row.id, { scheduledTime: slotToScheduledTime(slot) })}
                                  type="button"
                                >
                                  {slotLabel(slot)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-sm text-[var(--muted)]">優先度</p>
                          <div className="flex flex-wrap gap-2">
                            {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                              <button
                                key={`${row.id}-${priority}-desktop`}
                                className={priorityPillClass(row.priority === priority)}
                                onClick={() => updateBatchRow(row.id, { priority })}
                                type="button"
                              >
                                {formatPriorityIcon(priority)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--ink-soft)]">繰り返し</p>
                            <button
                              className={row.recurrenceEnabled ? segmentedActiveButtonClass : segmentedButtonClass}
                              onClick={() => updateBatchRow(row.id, {
                                recurrenceEnabled: !row.recurrenceEnabled,
                                recurrenceEndDate: !row.recurrenceEnabled && !row.recurrenceEndDate ? row.scheduledDate : row.recurrenceEndDate,
                              })}
                              type="button"
                            >
                              {row.recurrenceEnabled ? "ON" : "OFF"}
                            </button>
                          </div>

                          {row.recurrenceEnabled ? (
                            <div className="mt-4 grid gap-4">
                              <div className="grid gap-4 md:grid-cols-3">
                                <FormField label="繰り返し">
                                  <select
                                    className={inputClass}
                                    value={row.recurrenceFrequency}
                                    onChange={(event) => updateBatchRow(row.id, {
                                      recurrenceFrequency: event.target.value as BatchTaskRow["recurrenceFrequency"],
                                    })}
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
                                    value={row.recurrenceInterval}
                                    onChange={(event) => updateBatchRow(row.id, {
                                      recurrenceInterval: Math.max(1, Number(event.target.value || 1)),
                                    })}
                                  />
                                </FormField>
                                {row.recurrenceFrequency === "monthly" ? (
                                  <FormField label="毎月の日">
                                    <input
                                      className={inputClass}
                                      type="number"
                                      min={1}
                                      max={31}
                                      value={row.recurrenceDayOfMonth}
                                      onChange={(event) => updateBatchRow(row.id, {
                                        recurrenceDayOfMonth: Math.min(31, Math.max(1, Number(event.target.value || 1))),
                                      })}
                                    />
                                  </FormField>
                                ) : (
                                  <div />
                                )}
                              </div>

                              {row.recurrenceFrequency === "weekly" ? (
                                <FormField label="曜日">
                                  <div className="flex flex-wrap gap-2">
                                    {WEEKDAY_OPTIONS.map((option) => {
                                      const checked = row.recurrenceDaysOfWeek.includes(option.value);
                                      return (
                                        <button
                                          key={`${row.id}-${option.value}-desktop`}
                                          className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${
                                            checked
                                              ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                              : "border-black/10 bg-white text-[var(--ink-soft)]"
                                          }`}
                                          onClick={() => updateBatchRow(row.id, {
                                            recurrenceDaysOfWeek: checked
                                              ? row.recurrenceDaysOfWeek.filter((day) => day !== option.value)
                                              : [...row.recurrenceDaysOfWeek, option.value].sort((a, b) => a - b),
                                          })}
                                          type="button"
                                        >
                                          {option.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </FormField>
                              ) : null}

                              <div className="grid gap-4 md:grid-cols-2">
                                <FormField label="期間開始">
                                  <input
                                    className={inputClass}
                                    type="date"
                                    value={row.scheduledDate}
                                    onChange={(event) => updateBatchRow(row.id, {
                                      scheduledDate: event.target.value,
                                      recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                                      recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                                    })}
                                  />
                                </FormField>
                                <FormField label="期間終了">
                                  <input
                                    className={inputClass}
                                    type="date"
                                    value={row.recurrenceEndDate}
                                    min={row.scheduledDate}
                                    onChange={(event) => updateBatchRow(row.id, { recurrenceEndDate: event.target.value })}
                                  />
                                </FormField>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-[var(--muted)]">単発タスクとして登録します。</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button className={primaryButtonClass} onClick={handleBatchSaveTasks} type="button" disabled={isSubmitting}>
                  {isSubmitting ? "登録中..." : "一括登録する"}
                </button>
              </div>
            </Card>
          ) : null}
        </main>
      </div>

      {screenMode === "home" ? (
        <div className="lg:hidden">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)] lg:items-start">
          <div className="grid gap-5">
            <Card>
              {/* ヘッダー: グループセレクタ + 一覧リンク + 新規ボタン */}
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-[var(--muted)] outline-none"
                  value={activeGroupId}
                  onChange={(event) => setCurrentGroupId(event.target.value)}
                >
                  {state.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <button
                  className="shrink-0 rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]"
                  onClick={() => setScreenMode("tasks")}
                  type="button"
                >
                  一覧
                </button>
                <button className={primaryIconButtonClass} onClick={openCreateTask} type="button">
                  +
                </button>
              </div>

              {/* 日付ヘッダー */}
              <div
                key={homeDateMotionKey}
                className={`mt-3 ${
                  homeDateMotion === "prev"
                    ? "home-date-slide-prev"
                    : homeDateMotion === "next"
                      ? "home-date-slide-next"
                      : "home-date-slide-reset"
                }`}
              >
                <h1 className="font-[family-name:var(--font-heading)] text-[1.85rem] leading-none tracking-[-0.03em] lg:text-[2.3rem]">
                  {formatHomeHeadingDate(homeDate)}
                </h1>
                <p className="mt-1 text-xs font-medium text-[var(--muted)]">
                  {homeDateOffset === 0
                    ? "本日"
                    : homeDateOffset > 0
                      ? `${homeDateOffset}日後`
                      : `${Math.abs(homeDateOffset)}日前`}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 lg:gap-3">
                <SummaryCard label="未着手" value={counts.pending} tone="default" />
                <SummaryCard label="作業中" value={counts.inProgress} tone="warning" />
                <SummaryCard label="確認待ち" value={counts.awaitingConfirmation} tone="warning" />
                <SummaryCard label="完了" value={counts.done} tone="success" />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5 lg:max-w-md lg:gap-2">
                <button
                  className={homeDateOffset < 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                  onClick={() => moveHomeDate(-1)}
                  type="button"
                >
                  前日
                </button>
                <button
                  className={homeDateOffset === 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                  onClick={resetHomeDateToToday}
                  type="button"
                >
                  本日
                </button>
                <button
                  className={homeDateOffset > 0 ? segmentedActiveButtonClass : segmentedButtonClass}
                  onClick={() => moveHomeDate(1)}
                  type="button"
                >
                  翌日
                </button>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  className="text-xs font-medium text-[var(--muted)] underline-offset-2 hover:underline disabled:opacity-40"
                  onClick={() => setShowGroupModal(true)}
                  type="button"
                  disabled={!currentGroup}
                >
                  グループ詳細
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

            <Card>
              <h2 className="mb-4 font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">タスク</h2>
              {sortedTasks.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">今日のタスクはありません。</p>
              ) : (
                <section className="grid gap-3 lg:grid-cols-2">
                  {sortedTasks.map((task) => (
                    <button
                      key={task.id}
                      className={`w-full rounded-[24px] border border-black/5 px-4 py-4 text-left transition-transform active:scale-[0.99] ${taskCardSurfaceClass(task)}`}
                      onClick={() => openTaskDetail(task)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="font-[family-name:var(--font-heading)] text-sm leading-6 tracking-[-0.01em] text-[var(--ink)]">
                            {formatTaskTitleIcon(task)}{" "}
                            {task.title}
                            {task.recurrence_rule_id && (
                              <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#244234] bg-[#d1fae5] align-middle">繰返</span>
                            )}
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            {slotLabel(scheduledTimeToSlot(task.scheduled_time))} / {formatStatus(task.status)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
              )}
            </Card>
          </div>

          <div className="grid gap-5">
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
                    onClick={() => setShowManageModal(true)}
                    type="button"
                  >
                    確認
                  </button>
                </div>
              </Card>
            ) : null}

            {isPwaMode && pushSetupNotice ? (
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        pushSetupNotice.tone === "error" ? "text-[var(--danger)]" : "text-[var(--brand)]"
                      }`}
                    >
                      通知設定の案内
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{pushSetupNotice.message}</p>
                  </div>
                  {pushSetupNotice.actionLabel ? (
                    <button className={secondaryButtonClass} onClick={handlePushSetupAction} type="button">
                      {pushSetupNotice.actionLabel}
                    </button>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {devicePermissionNotice ? (
              <Card>
                <p className="text-sm font-semibold text-[var(--brand)]">権限の案内</p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{devicePermissionNotice.message}</p>
              </Card>
            ) : null}

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">通知</h2>
                {olderLogs.length > 0 ? (
                  <button
                    className="text-sm font-semibold text-[var(--brand)]"
                    onClick={() => setScreenMode("notifications")}
                    type="button"
                  >
                    過去 {olderLogs.length} 件
                  </button>
                ) : null}
              </div>
              <div className="mt-4">
                {latestLog ? (
                  <NotificationBubble
                    isOpen={openNotificationId === latestLog.id}
                    log={latestLog}
                    onClose={() => setOpenNotificationId(null)}
                    onDismiss={() => handleDismissLog(latestLog.id)}
                    onOpen={() => setOpenNotificationId(latestLog.id)}
                    onTaskClick={isTaskLinkedLog(latestLog) ? () => openTaskFromLog(latestLog) : undefined}
                  />
                ) : (
                  <p className="text-sm text-[var(--muted)]">通知はまだありません。</p>
                )}
              </div>
            </Card>

            <section className="grid grid-cols-2 gap-3">
              {state.appUser.role === "admin" ? (
                <button
                  className={bottomActionButtonClass}
                  onClick={() => setShowManageModal(true)}
                  type="button"
                >
                  管理
                </button>
              ) : (
                <div />
              )}
              <button
                className={bottomActionButtonClass}
                onClick={handleLogout}
                type="button"
                disabled={isSubmitting}
              >
                {isSubmitting ? "処理中" : "ログアウト"}
              </button>
            </section>
          </div>
        </div>
        </div>
      ) : null}

      {screenMode === "tasks" ? (
        <div className="lg:hidden">
        <OverlayModal onClose={() => setScreenMode("home")} maxWidthClass="max-w-4xl">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">
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
            <div className="mt-4 flex gap-2">
              <button
                className={secondaryButtonClass}
                onClick={() => setScreenMode("bulk")}
                type="button"
              >
                一括登録
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="開始日">
                <NativePickerField
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                />
              </FormField>
              <FormField label="終了日">
                <NativePickerField
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                />
              </FormField>
            </div>
          </div>

          <section className="mt-5 grid gap-4">
            {rangedTasks.map((task) => (
              <section
                key={task.id}
                className={`rounded-[28px] border border-black/5 px-5 py-5 shadow-[0_14px_28px_rgba(31,41,51,0.05)] ${taskCardSurfaceClass(task)}`}
              >
                <div className="grid gap-3">
                  <div className="min-w-0">
                    <h2 className="font-[family-name:var(--font-heading)] text-sm leading-6 tracking-[-0.01em] text-[var(--ink)]">
                      {formatTaskTitleIcon(task)}{" "}
                      {task.title}
                      {task.recurrence_rule_id && (
                        <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#244234] bg-[#d1fae5] align-middle">繰返</span>
                      )}
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                        {task.scheduled_date}
                      </span>
                      <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                        {slotLabel(scheduledTimeToSlot(task.scheduled_time))}
                      </span>
                      <span className={taskStatusChipClass(task.status)}>{formatStatus(task.status)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      className={miniUtilityButtonClass}
                      onClick={() => openEditTask(task)}
                      type="button"
                    >
                      編集
                    </button>
                    <button
                      className={miniUtilityButtonClass}
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
                      className={miniDangerButtonClass}
                      onClick={() => handleDeleteTask(task.id)}
                      type="button"
                      disabled={taskDeletePendingId === task.id}
                    >
                      {taskDeletePendingId === task.id ? "削除中" : "削除"}
                    </button>
                  </div>
                </div>
              </section>
            ))}
          </section>
        </OverlayModal>
        </div>
      ) : null}

      {screenMode === "notifications" ? (
        <div className="lg:hidden">
        <>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                  通知一覧
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  直近7日分の通知を確認できます。
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

          <section className="grid gap-3">
            {state.logs.length > 0 ? (
              state.logs.map((log) => (
                <NotificationBubble
                  key={log.id}
                  isOpen={openNotificationId === log.id}
                  log={log}
                  onClose={() => setOpenNotificationId(null)}
                  onDismiss={() => handleDismissLog(log.id)}
                  onOpen={() => setOpenNotificationId(log.id)}
                  onTaskClick={isTaskLinkedLog(log) ? () => openTaskFromLog(log) : undefined}
                />
              ))
            ) : (
              <Card>
                <p className="text-sm text-[var(--muted)]">通知はまだありません。</p>
              </Card>
            )}
          </section>
        </>
        </div>
      ) : null}

      {screenMode === "bulk" ? (
        <div className="lg:hidden">
        <OverlayModal onClose={() => setScreenMode("tasks")} maxWidthClass="max-w-[min(99vw,1800px)]">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">
                  一括登録
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  複数タスクを個別入力してまとめて登録します。
                </p>
              </div>
              <button
                className={secondaryButtonClass}
                onClick={() => setScreenMode("tasks")}
                type="button"
              >
                戻る
              </button>
            </div>
            <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              登録先グループ: {currentGroup?.name ?? "グループ未設定"}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={secondaryButtonClass} onClick={() => appendBatchRows(5)} type="button">
                行を5件追加
              </button>
              <button className={secondaryButtonClass} onClick={removeEmptyBatchRows} type="button">
                空行を整理
              </button>
              <button
                className={secondaryButtonClass}
                onClick={() => setBatchRows(Array.from({ length: 8 }, () => createBatchTaskRow(homeDate)))}
                type="button"
              >
                行をリセット
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:hidden">
            {batchRows.map((row, index) => (
              <Card key={row.id}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-[family-name:var(--font-heading)] text-base tracking-[-0.03em]">
                    行 {index + 1}
                  </h3>
                  <button
                    className={miniDangerButtonClass}
                    onClick={() =>
                      setBatchRows((current) =>
                        current.length <= 1 ? current : current.filter((item) => item.id !== row.id),
                      )
                    }
                    type="button"
                    disabled={batchRows.length <= 1}
                  >
                    削除
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  <FormField label="タイトル">
                    <input
                      className={inputClass}
                      value={row.title}
                      placeholder="タスク名"
                      onChange={(event) => updateBatchRow(row.id, { title: event.target.value })}
                    />
                  </FormField>
                  <FormField label="説明">
                    <textarea
                      className={`${inputClass} min-h-24`}
                      value={row.description}
                      placeholder="説明"
                      onChange={(event) => updateBatchRow(row.id, { description: event.target.value })}
                    />
                  </FormField>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[var(--ink)]">説明画像</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">各行ごとに2枚まで添付できます。</p>
                    </div>
                    <label className={secondaryButtonClass}>
                      追加
                      <input
                        className="hidden"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []).filter((file) =>
                            file.type.startsWith("image/"),
                          );
                          updateBatchRow(row.id, {
                            pendingReferenceFiles: [...row.pendingReferenceFiles, ...files].slice(0, 2),
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>

                  {row.pendingReferenceFiles.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {row.pendingReferenceFiles.map((file, fileIndex) => (
                        <div key={`${row.id}-${file.name}-${fileIndex}`} className="rounded-2xl bg-[var(--surface)] px-3 py-3">
                          <p className="truncate text-xs font-semibold text-[var(--ink-soft)]">{file.name}</p>
                          <button
                            className="mt-2 text-xs font-semibold text-[var(--danger)]"
                            onClick={() =>
                              updateBatchRow(row.id, {
                                pendingReferenceFiles: row.pendingReferenceFiles.filter((_, indexValue) => indexValue !== fileIndex),
                              })
                            }
                            type="button"
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!row.recurrenceEnabled ? (
                    <FormField label="実行日">
                      <NativePickerField
                        type="date"
                        value={row.scheduledDate}
                        onChange={(event) =>
                          updateBatchRow(row.id, {
                            scheduledDate: event.target.value,
                            recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                            recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                          })
                        }
                      />
                    </FormField>
                  ) : null}

                  <div>
                    <p className="mb-2 text-sm text-[var(--muted)]">時間帯</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["morning", "afternoon", "anytime"] as const).map((slot) => (
                        <button
                          key={`${row.id}-${slot}`}
                          className={selectedSlotButtonClass(scheduledTimeToSlot(row.scheduledTime) === slot)}
                          onClick={() => updateBatchRow(row.id, { scheduledTime: slotToScheduledTime(slot) })}
                          type="button"
                        >
                          {slotLabel(slot)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-sm text-[var(--muted)]">優先度</p>
                    <div className="flex gap-2">
                      {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                        <button
                          key={`${row.id}-${priority}`}
                          className={priorityPillClass(row.priority === priority)}
                          onClick={() => updateBatchRow(row.id, { priority })}
                          type="button"
                        >
                          {formatPriorityIcon(priority)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl bg-[var(--surface)] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-[var(--ink)]">繰り返し</p>
                      <button
                        className={row.recurrenceEnabled ? segmentedActiveButtonClass : segmentedButtonClass}
                        onClick={() =>
                          updateBatchRow(row.id, {
                            recurrenceEnabled: !row.recurrenceEnabled,
                            recurrenceEndDate:
                              !row.recurrenceEnabled && !row.recurrenceEndDate ? row.scheduledDate : row.recurrenceEndDate,
                          })
                        }
                        type="button"
                      >
                        {row.recurrenceEnabled ? "ON" : "OFF"}
                      </button>
                    </div>

                    {row.recurrenceEnabled ? (
                      <div className="mt-4 grid gap-3">
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="開始日">
                            <NativePickerField
                              type="date"
                              value={row.scheduledDate}
                              onChange={(event) =>
                                updateBatchRow(row.id, {
                                  scheduledDate: event.target.value,
                                  recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                                  recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                                })
                              }
                            />
                          </FormField>
                          <FormField label="終了日">
                            <NativePickerField
                              type="date"
                              value={row.recurrenceEndDate}
                              onChange={(event) => updateBatchRow(row.id, { recurrenceEndDate: event.target.value })}
                            />
                          </FormField>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="繰り返し">
                            <select
                              className={inputClass}
                              value={row.recurrenceFrequency}
                              onChange={(event) =>
                                updateBatchRow(row.id, {
                                  recurrenceFrequency: event.target.value as TaskFormState["recurrenceFrequency"],
                                })
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
                              value={row.recurrenceInterval}
                              onChange={(event) =>
                                updateBatchRow(row.id, {
                                  recurrenceInterval: Math.max(1, Number(event.target.value || 1)),
                                })
                              }
                            />
                          </FormField>
                        </div>
                        {row.recurrenceFrequency === "weekly" ? (
                          <div className="flex flex-wrap gap-2">
                            {WEEKDAY_OPTIONS.map((option) => {
                              const checked = row.recurrenceDaysOfWeek.includes(option.value);
                              return (
                                <button
                                  key={`${row.id}-${option.value}`}
                                  className={checked ? segmentedActiveButtonClass : segmentedButtonClass}
                                  onClick={() =>
                                    updateBatchRow(row.id, {
                                      recurrenceDaysOfWeek: checked
                                        ? row.recurrenceDaysOfWeek.filter((day) => day !== option.value)
                                        : [...row.recurrenceDaysOfWeek, option.value].sort((a, b) => a - b),
                                    })
                                  }
                                  type="button"
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        {row.recurrenceFrequency === "monthly" ? (
                          <FormField label="毎月の日">
                            <input
                              className={inputClass}
                              type="number"
                              min={1}
                              max={31}
                              value={row.recurrenceDayOfMonth}
                              onChange={(event) =>
                                updateBatchRow(row.id, {
                                  recurrenceDayOfMonth: Math.min(31, Math.max(1, Number(event.target.value || 1))),
                                })
                              }
                            />
                          </FormField>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto lg:block">
            <table className="min-w-[1320px] w-full table-fixed border-separate border-spacing-y-3">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[16%]" />
                <col className="w-[19%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[3%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">タイトル</th>
                  <th className="px-3 py-2">説明</th>
                  <th className="px-3 py-2">画像</th>
                  <th className="px-3 py-2">実行日</th>
                  <th className="px-3 py-2">時間帯</th>
                  <th className="px-3 py-2">優先度</th>
                  <th className="px-3 py-2">繰り返し</th>
                  <th className="px-3 py-2">期間</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((row, index) => (
                  <tr key={row.id} className="align-top">
                    <td className="rounded-l-[24px] border border-black/5 bg-white px-2 py-4 text-sm font-semibold text-[var(--ink)]">
                      {index + 1}
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <div className="grid gap-2">
                        <input
                          className={inputClass}
                          value={row.title}
                          placeholder="タスク名"
                          onChange={(event) => updateBatchRow(row.id, { title: event.target.value })}
                        />
                      </div>
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <textarea
                        className={`${inputClass} min-h-28`}
                        value={row.description}
                        placeholder="説明"
                        onChange={(event) => updateBatchRow(row.id, { description: event.target.value })}
                      />
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <div className="grid gap-2">
                        <label className={`${secondaryButtonClass} inline-flex w-full justify-center`}>
                          追加
                          <input
                            className="hidden"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.currentTarget.files ?? []).filter((file) =>
                                file.type.startsWith("image/"),
                              );
                              updateBatchRow(row.id, {
                                pendingReferenceFiles: [...row.pendingReferenceFiles, ...files].slice(0, 2),
                              });
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <div className="grid gap-2">
                          {row.pendingReferenceFiles.length > 0 ? (
                            row.pendingReferenceFiles.map((file, fileIndex) => (
                              <div
                                key={`${row.id}-${file.name}-${fileIndex}-table`}
                                className="rounded-2xl bg-[var(--surface)] px-3 py-2"
                              >
                                <p className="truncate text-xs font-semibold text-[var(--ink-soft)]">{file.name}</p>
                                <button
                                  className="mt-1 text-xs font-semibold text-[var(--danger)]"
                                  onClick={() =>
                                    updateBatchRow(row.id, {
                                      pendingReferenceFiles: row.pendingReferenceFiles.filter(
                                        (_, indexValue) => indexValue !== fileIndex,
                                      ),
                                    })
                                  }
                                  type="button"
                                >
                                  削除
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-[var(--muted)]">未追加</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      {!row.recurrenceEnabled ? (
                        <NativePickerField
                          type="date"
                          value={row.scheduledDate}
                          onChange={(event) =>
                            updateBatchRow(row.id, {
                              scheduledDate: event.target.value,
                              recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                              recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                            })
                          }
                        />
                      ) : (
                        <div className="rounded-2xl bg-[var(--chip)] px-3 py-3 text-sm text-[var(--muted)]">
                          繰り返し時は期間で管理
                        </div>
                      )}
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <div className="grid grid-cols-1 gap-2">
                        {(["morning", "afternoon", "anytime"] as const).map((slot) => (
                          <button
                            key={`${row.id}-${slot}-table`}
                            className={selectedSlotButtonClass(scheduledTimeToSlot(row.scheduledTime) === slot)}
                            onClick={() => updateBatchRow(row.id, { scheduledTime: slotToScheduledTime(slot) })}
                            type="button"
                          >
                            {slotLabel(slot)}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <div className="flex flex-wrap gap-2">
                        {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                          <button
                            key={`${row.id}-${priority}-table`}
                            className={priorityPillClass(row.priority === priority)}
                            onClick={() => updateBatchRow(row.id, { priority })}
                            type="button"
                          >
                            {formatPriorityIcon(priority)}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      <button
                        className={row.recurrenceEnabled ? segmentedActiveButtonClass : segmentedButtonClass}
                        onClick={() =>
                          updateBatchRow(row.id, {
                            recurrenceEnabled: !row.recurrenceEnabled,
                            recurrenceEndDate:
                              !row.recurrenceEnabled && !row.recurrenceEndDate ? row.scheduledDate : row.recurrenceEndDate,
                          })
                        }
                        type="button"
                      >
                        {row.recurrenceEnabled ? "ON" : "OFF"}
                      </button>
                      {row.recurrenceEnabled ? (
                        <div className="mt-3 grid gap-2">
                          <select
                            className={inputClass}
                            value={row.recurrenceFrequency}
                            onChange={(event) =>
                              updateBatchRow(row.id, {
                                recurrenceFrequency: event.target.value as TaskFormState["recurrenceFrequency"],
                              })
                            }
                          >
                            <option value="daily">毎日</option>
                            <option value="weekly">曜日指定（毎週）</option>
                            <option value="monthly">毎月</option>
                          </select>
                          <input
                            className={inputClass}
                            type="number"
                            min={1}
                            value={row.recurrenceInterval}
                            onChange={(event) =>
                              updateBatchRow(row.id, {
                                recurrenceInterval: Math.max(1, Number(event.target.value || 1)),
                              })
                            }
                          />
                          {row.recurrenceFrequency === "weekly" ? (
                            <div className="flex flex-wrap gap-1">
                              {WEEKDAY_OPTIONS.map((option) => {
                                const checked = row.recurrenceDaysOfWeek.includes(option.value);
                                return (
                                  <button
                                    key={`${row.id}-${option.value}-table`}
                                    className={`rounded-xl border px-2 py-1 text-xs font-semibold ${
                                      checked
                                        ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                        : "border-black/10 bg-white text-[var(--ink-soft)]"
                                    }`}
                                    onClick={() =>
                                      updateBatchRow(row.id, {
                                        recurrenceDaysOfWeek: checked
                                          ? row.recurrenceDaysOfWeek.filter((value) => value !== option.value)
                                          : [...row.recurrenceDaysOfWeek, option.value].sort(),
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="border-y border-black/5 bg-white px-2 py-4">
                      {row.recurrenceEnabled ? (
                        <div className="grid gap-2">
                          <input
                            className={inputClass}
                            type="date"
                            value={row.scheduledDate}
                            onChange={(event) =>
                              updateBatchRow(row.id, {
                                scheduledDate: event.target.value,
                                recurrenceDaysOfWeek: [weekdayFromDate(event.target.value)],
                                recurrenceDayOfMonth: dayOfMonthFromDate(event.target.value),
                              })
                            }
                          />
                          <input
                            className={inputClass}
                            type="date"
                            value={row.recurrenceEndDate}
                            min={row.scheduledDate}
                            onChange={(event) => updateBatchRow(row.id, { recurrenceEndDate: event.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-[var(--chip)] px-3 py-3 text-sm text-[var(--muted)]">
                          単発タスク
                        </div>
                      )}
                    </td>
                    <td className="rounded-r-[24px] border border-black/5 bg-white px-2 py-4">
                      <button
                        className={miniDangerButtonClass}
                        onClick={() =>
                          setBatchRows((current) =>
                            current.length <= 1 ? current : current.filter((item) => item.id !== row.id),
                          )
                        }
                        type="button"
                        disabled={batchRows.length <= 1}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className={primaryButtonClass}
              onClick={handleBatchSaveTasks}
              type="button"
              disabled={isSubmitting}
            >
              {isSubmitting ? "登録中..." : "一括登録する"}
            </button>
          </div>
        </OverlayModal>
        </div>
      ) : null}


      {showGroupModal ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 p-4 lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowGroupModal(false);
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 max-h-[min(88vh,720px)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] bg-white px-5 py-5 shadow-2xl lg:w-[min(92vw,760px)] lg:max-w-[760px] lg:px-7"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/10" />
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">グループ詳細</h3>
              <button className={secondaryButtonClass} onClick={() => setShowGroupModal(false)} type="button">閉じる</button>
            </div>
            <div className="mt-4 grid gap-4">
              {currentGroup ? (
                <div className="rounded-[20px] bg-[var(--chip)] px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">GROUP</p>
                  <p className="mt-2 font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em] text-[var(--ink)]">
                    {currentGroup.name}
                  </p>
                  {currentGroup.description ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{currentGroup.description}</p>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">グループ説明は設定されていません。</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">グループが見つかりません。</p>
              )}
              <div className="rounded-[20px] border border-[var(--danger)]/20 bg-red-50/60 px-4 py-4">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--danger)]/70">危険操作</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                  この操作を行うと、現在のグループから退出します。過去の履歴は残ります。
                </p>
                <button
                  className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--danger)]"
                  onClick={handleLeaveCurrentGroup}
                  type="button"
                  disabled={isSubmitting || !currentGroup}
                >
                  {isSubmitting ? "処理中..." : "このグループから退出"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {memberToDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-3xl bg-[var(--surface)] p-6 shadow-xl">
            <h3 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">メンバーを削除</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              <span className="font-semibold text-[var(--ink)]">{memberToDelete.name}</span> さんを削除しますか？この操作は取り消せません。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                className={secondaryButtonClass}
                onClick={() => setMemberToDelete(null)}
                type="button"
                disabled={removeMemberPending}
              >
                キャンセル
              </button>
              <button
                className="flex-1 rounded-2xl bg-[var(--danger)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => { void confirmRemoveMember(); }}
                type="button"
                disabled={removeMemberPending}
              >
                {removeMemberPending ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showManageModal ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 p-4 lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowManageModal(false);
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 max-h-[min(92vh,820px)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] bg-white px-5 py-5 shadow-2xl lg:w-[min(94vw,980px)] lg:max-w-[980px] lg:px-7"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/10" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">管理画面</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">メンバー承認・招待・設定</p>
              </div>
              <button className={secondaryButtonClass} onClick={() => setShowManageModal(false)} type="button">閉じる</button>
            </div>
            <div className="mt-5 grid gap-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">承認待ち申請</p>
                <div className="mt-2">
                  {state.pendingRequests.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">承認待ちはありません。</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {state.pendingRequests.map((item) => (
                        <PendingRequestCard
                          key={item.id}
                          groups={state.groups}
                          item={item}
                          isPending={approvalPendingId === item.id}
                          onApprove={() => handleApproveRequest(item.id)}
                          onReject={() => handleRejectRequest(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">メンバー</p>
                <div className="mt-2 flex flex-col gap-2">
                  {state.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between rounded-[18px] bg-[var(--chip)] px-3 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-semibold">{member.display_name}</p>
                        <p className="text-xs text-[var(--muted)]">{member.role}</p>
                      </div>
                      {state.appUser?.role === "admin" ? (
                        <button
                          className="rounded-xl border border-[var(--danger)]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--danger)]"
                          onClick={() => setMemberToDelete({ id: member.id, name: member.display_name })}
                          type="button"
                        >
                          削除
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              {state.appUser?.role === "admin" ? (
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">グループ招待</p>
                    <div className="mt-2 flex flex-col gap-3">
                      {state.groups.map((group) => (
                        <div key={group.id} className="rounded-[18px] bg-[var(--chip)] px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{group.name}</p>
                              <p className="text-xs text-[var(--muted)]">24時間有効</p>
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
                            <div className="mt-2 flex items-center gap-2">
                              <p className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 text-xs text-[var(--ink-soft)]">
                                {inviteLinks[group.id]}
                              </p>
                              <button
                                className={secondaryButtonClass}
                                onClick={() => void copyText("招待リンク", inviteLinks[group.id])}
                                type="button"
                              >
                                コピー
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">通知設定</p>
                    <div className="mt-2 grid gap-3">
                      <FormField label="朝通知時刻（タスクあり）">
                        <NativePickerField
                          type="time"
                          value={notificationTime}
                          onChange={(event) => setNotificationTime(event.target.value)}
                        />
                      </FormField>
                      <FormField label="夕方通知時刻（未完了リマインド）">
                        <NativePickerField
                          type="time"
                          value={notificationTime2}
                          onChange={(event) => setNotificationTime2(event.target.value)}
                        />
                      </FormField>
                      <p className="text-xs text-[var(--muted)]">
                        タイムゾーン: {state.workspace?.timezone ?? "Asia/Tokyo"}
                        {"　"}夕方通知は未完了タスクがある場合のみ送信
                      </p>
                      <button
                        className={primaryButtonClass}
                        onClick={handleSaveWorkspaceSettings}
                        type="button"
                        disabled={workspaceSettingsPending}
                      >
                        {workspaceSettingsPending ? "保存中..." : "通知時刻を保存"}
                      </button>
                      <button
                        className={secondaryButtonClass}
                        disabled={isSendingTestNotification}
                        onClick={handleSendDelayedTestNotification}
                        type="button"
                      >
                        {isSendingTestNotification ? "送信中..." : "10秒後にテスト通知"}
                      </button>
                    </div>
                  </div>
            </div>
          </div>
        </div>
      ) : null}

      {createTaskOpen ? (
        <div className="lg:hidden">
          <TaskModal
            currentGroupName={
              state.groups.find((group) => group.id === activeGroupId)?.name ?? "グループ未設定"
            }
            availableCopyTasks={state.tasks.filter(
              (task) => !task.deleted_at && task.group_id === activeGroupId,
            )}
            copySourceTaskId={copySourceTaskId}
            form={taskForm}
            isEditing={Boolean(editingTaskId)}
            isSaving={taskSavePending}
            pendingReferenceFiles={pendingReferenceFiles}
            onCopySourceChange={handleCopySourceChange}
            onClose={() => setCreateTaskOpen(false)}
            onSave={handleSaveTask}
            setPendingReferenceFiles={setPendingReferenceFiles}
            setForm={setTaskForm}
            hasRecurrenceRule={Boolean(editingTaskId && state.tasks.find((t) => t.id === editingTaskId)?.recurrence_rule_id)}
            updateScope={editUpdateScope}
            onUpdateScopeChange={setEditUpdateScope}
          />
        </div>
      ) : null}

      {selectedTask ? (
        <div className="lg:hidden">
          <TaskDetailModal
            actionPending={taskActionPending}
            task={selectedTask}
            onClose={() => setSelectedTaskId(null)}
            onCopyText={copyText}
            onAction={(action) => void performTaskAction(selectedTask, action)}
            onReferencePhotoUpload={(file) => void handleReferencePhotoUpload(selectedTask.id, file)}
            onReferencePhotoDelete={(photoId) =>
              void handleReferencePhotoDelete(selectedTask.id, photoId)
            }
            onReferencePhotoReplace={(photoId, file) =>
              void handleReferencePhotoReplace(selectedTask.id, photoId, file)
            }
            onPhotoUpload={(file) => void handlePhotoUpload(selectedTask.id, file)}
            onPhotoDelete={(photoId) => void handlePhotoDelete(selectedTask.id, photoId)}
            onPhotoReplace={(photoId, file) => void handlePhotoReplace(selectedTask.id, photoId, file)}
            onPreview={(url) => setPreviewPhotoUrl(url)}
          />
        </div>
      ) : null}

      {previewPhotoUrl ? (
        <ImagePreviewModal imageUrl={previewPhotoUrl} onClose={() => setPreviewPhotoUrl(null)} />
      ) : null}
    </Shell>
  );
}

function Spinner() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/60 backdrop-blur-sm">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--brand)]/20 border-t-[var(--brand)]" />
    </div>
  );
}

function Shell({
  children,
  appVersion,
  commitSha,
  toasts,
  enablePushPrompt = false,
  isProcessing = false,
  wide = false,
}: {
  children: React.ReactNode;
  appVersion: string;
  commitSha: string;
  toasts: Toast[];
  enablePushPrompt?: boolean;
  isProcessing?: boolean;
  wide?: boolean;
}) {
  return (
    <>
      <PwaRegister enablePushPrompt={enablePushPrompt} />
      {isProcessing ? <Spinner /> : null}
      <div
        className={`mx-auto flex w-full flex-col bg-transparent text-[var(--ink)] ${
          wide
            ? "min-h-screen pb-10 pt-5 max-w-[1680px] px-4 sm:px-5 lg:block lg:min-h-0 lg:p-0 lg:max-w-none"
            : "min-h-screen pb-10 pt-5 max-w-md px-5"
        }`}
      >
        <div className={`mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--brand)]/20${wide ? " lg:hidden" : ""}`} />
        <div className={`flex flex-col gap-5${wide ? " lg:block" : ""}`}>{children}</div>
        <div className={wide ? "lg:hidden" : ""}><Footer appVersion={appVersion} commitSha={commitSha} /></div>
      </div>
      <div
        className={`pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full flex-col gap-2 px-4 ${
          wide ? "max-w-[1680px] sm:px-5 lg:px-7 xl:px-8" : "max-w-md"
        }`}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-2xl px-4 py-3.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.20)] ${
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
  authSuccess,
  onStartLineLogin,
  isLoading,
  toasts,
}: {
  appVersion: string;
  commitSha: string;
  authSuccess: boolean;
  onStartLineLogin: () => void;
  isLoading: boolean;
  toasts: Toast[];
}) {
  return (
    <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts} isProcessing={isLoading}>
      <Card>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">TEAM TASK</p>
        <h1 className="mt-3 font-[family-name:var(--font-heading)] text-[2.3rem] leading-none tracking-[-0.05em]">
          チームの今日を
          <br />
          すぐ動かす
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
          LINEでログインして、オフライン対応のPWAとして利用します。
        </p>
        <button
          className="mt-8 flex h-14 items-center justify-center rounded-2xl bg-[var(--brand)] text-base font-semibold text-white shadow-[0_6px_18px_rgba(79,70,229,0.32)] transition-transform active:scale-[0.98] disabled:opacity-60"
          onClick={onStartLineLogin}
          type="button"
          disabled={isLoading}
        >
          {isLoading ? "LINEへ移動中..." : "LINEでログイン"}
        </button>
        {authSuccess ? (
          <p className="mt-3 text-sm text-[var(--brand)]">
            ログインが完了しました。画面が切り替わらない場合は一度だけ再読み込みしてください。
          </p>
        ) : null}
      </Card>
    </Shell>
  );
}

function Card({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <section className={`rounded-[28px] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(15,23,42,0.07)] ${className ?? ""}`}>
      {title ? (
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function OverlayModal({
  children,
  onClose,
  maxWidthClass = "max-w-3xl",
}: {
  children: React.ReactNode;
  onClose: () => void;
  maxWidthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 p-2 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`absolute left-1/2 top-1/2 max-h-[min(90vh,900px)] w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] ${maxWidthClass} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] bg-white px-4 py-5 sm:px-5 lg:px-6 shadow-2xl`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/10" />
        {children}
      </div>
    </div>
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
    <div className={`min-w-0 rounded-2xl px-3 py-3 ${toneClass}`}>
      <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.06em] opacity-65">{label}</p>
      <p className="mt-1.5 text-[1.75rem] font-bold leading-none">{value}</p>
    </div>
  );
}

function taskStatusChipClass(status: TaskRecord["status"]) {
  if (status === "done") {
    return "rounded-full bg-[var(--success-bg)] px-3 py-1 text-xs font-semibold text-[var(--success-ink)]";
  }

  if (status === "in_progress") {
    return "rounded-full bg-[var(--warning-bg)] px-3 py-1 text-xs font-semibold text-[var(--warning-ink)]";
  }

  if (status === "awaiting_confirmation") {
    return "rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#5b21b6]";
  }

  return "rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]";
}

function ActionButton({
  label,
  onClick,
  tone,
  disabled = false,
  loading = false,
}: {
  label: string;
  onClick: () => void;
  tone: "warning" | "success" | "neutral";
  disabled?: boolean;
  loading?: boolean;
}) {
  const toneClass =
    tone === "warning"
      ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-ink)]"
      : tone === "success"
        ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-ink)]"
        : "border-black/10 bg-white text-[var(--ink-soft)]";

  return (
    <button
      className={`w-full whitespace-nowrap rounded-2xl border px-2 py-2.5 text-[11px] font-semibold leading-none ${toneClass} ${
        disabled || loading ? "cursor-not-allowed opacity-35" : "transition-transform active:scale-[0.96]"
      }`}
      onClick={onClick}
      type="button"
      disabled={disabled || loading}
    >
      {loading ? "..." : label}
    </button>
  );
}

function PendingRequestCard({
  item,
  groups,
  isPending,
  onApprove,
  onReject,
}: {
  item: MembershipRequestRecord;
  groups: Group[];
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const groupName = groups.find((group) => group.id === item.group_id)?.name ?? "不明";

  return (
    <div className="rounded-2xl bg-[var(--chip)] px-4 py-4">
      <p className="font-semibold">{item.requested_name}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">申請先: {groupName}</p>
      <div className="mt-3 flex gap-2">
        <button className={primaryButtonClass} onClick={onApprove} type="button" disabled={isPending}>
          {isPending ? "処理中..." : "承認"}
        </button>
        <button className={secondaryDangerClass} onClick={onReject} type="button" disabled={isPending}>
          却下
        </button>
      </div>
    </div>
  );
}

function NotificationBubble({
  log,
  isOpen,
  onDismiss,
  onOpen,
  onClose,
  onTaskClick,
}: {
  log: TaskLogRecord;
  isOpen: boolean;
  onDismiss: () => void;
  onOpen: () => void;
  onClose: () => void;
  onTaskClick?: () => void;
}) {
  const actorName = log.actor?.display_name ?? "誰か";
  const actorImage = log.actor?.line_picture_url ?? null;
  const touchStartXRef = useRef<number | null>(null);
  const hasTask = Boolean(onTaskClick);

  return (
    <div className="relative w-full shrink-0 overflow-hidden rounded-[24px]">
      <div
        className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--danger)]/18 bg-white text-lg text-[var(--danger)] shadow-[0_8px_18px_rgba(31,41,51,0.08)]"
          onClick={onDismiss}
          type="button"
          aria-label="通知を削除"
        >
          🗑
        </button>
      </div>
      <div
        className={`flex w-full items-start gap-3 transition-transform duration-200 ${isOpen ? "-translate-x-14" : "translate-x-0"} ${
          hasTask ? "cursor-pointer" : ""
        }`}
        onClick={hasTask ? onTaskClick : undefined}
        onTouchStart={(event) => {
          touchStartXRef.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const startX = touchStartXRef.current;
          const endX = event.changedTouches[0]?.clientX ?? null;
          touchStartXRef.current = null;
          if (startX === null || endX === null) return;
          const deltaX = endX - startX;
          if (deltaX < -36) {
            onOpen();
          } else if (deltaX > 24) {
            onClose();
          }
        }}
      >
      {actorImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${actorName}のLINEアイコン`}
          className="h-11 w-11 rounded-full border border-black/5 object-cover shadow-[0_8px_18px_rgba(31,41,51,0.08)]"
          src={actorImage}
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold text-white shadow-[0_8px_18px_rgba(31,41,51,0.08)]">
          {actorInitial(actorName)}
        </div>
      )}
      <div
        className={`relative min-w-0 flex-1 rounded-[24px] bg-[var(--chip)] px-4 py-3 text-[var(--ink)] shadow-[0_10px_20px_rgba(31,41,51,0.05)] ${
          hasTask ? "hover:bg-[var(--chip)]/80 active:scale-[0.99] transition-all" : ""
        }`}
      >
        <div className="absolute left-[-7px] top-4 h-3.5 w-3.5 rotate-45 bg-[var(--chip)]" />
        <p className="text-sm font-semibold text-[var(--ink-soft)]">{actorName}</p>
        <p className="mt-1 text-sm leading-6">{logMessage(log)}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {new Date(log.created_at).toLocaleString("ja-JP")}
        </p>
      </div>
      </div>
    </div>
  );
}

function TaskModal({
  currentGroupName,
  availableCopyTasks,
  copySourceTaskId,
  form,
  pendingReferenceFiles,
  setForm,
  setPendingReferenceFiles,
  onClose,
  onSave,
  isEditing,
  isSaving,
  onCopySourceChange,
  hasRecurrenceRule = false,
  updateScope = "single",
  onUpdateScopeChange,
  inline = false,
}: {
  currentGroupName: string;
  availableCopyTasks: TaskRecord[];
  copySourceTaskId: string;
  form: TaskFormState;
  pendingReferenceFiles: File[];
  setForm: React.Dispatch<React.SetStateAction<TaskFormState>>;
  setPendingReferenceFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onClose: () => void;
  onSave: () => void;
  isEditing: boolean;
  isSaving: boolean;
  onCopySourceChange: (taskId: string) => void;
  hasRecurrenceRule?: boolean;
  updateScope?: "single" | "all";
  onUpdateScopeChange?: (scope: "single" | "all") => void;
  inline?: boolean;
}) {
  const selectedSlot = scheduledTimeToSlot(form.scheduledTime);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  function appendReferenceFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    setPendingReferenceFiles((current) => [...current, ...files].slice(0, 2));
  }

  const content = (
      <div
        className={`overflow-x-hidden overflow-y-auto rounded-[32px] bg-white ${
          inline
            ? "max-h-none px-1 py-1 shadow-none"
            : "max-h-[min(88vh,820px)] w-full max-w-md px-5 py-5 shadow-2xl lg:max-w-[980px] lg:px-7"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {inline ? null : <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-black/12" />}
        <h3 className="font-[family-name:var(--font-heading)] text-lg tracking-[-0.03em]">
          {isEditing ? "タスクを編集" : "タスクを追加"}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">追加先: {currentGroupName}</p>
        <div className="mt-4 grid gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--ink)]">既存タスクをコピー</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {availableCopyTasks.length > 0
                ? "選択すると入力欄へ反映されます。"
                : "コピー元に使える既存タスクはありません。"}
            </p>
            {availableCopyTasks.length > 0 ? (
              <select
                className={`${inputClass} mt-2`}
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
            ) : null}
          </div>
          <FormField label="タイトル">
            <input
              className={inputClass}
              placeholder="タスク名"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </FormField>
          <FormField label="説明">
            <textarea
              className={`${inputClass} min-h-28`}
              placeholder="説明"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </FormField>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--ink)]">説明画像</p>
              <p className="mt-1 text-xs text-[var(--muted)]">登録時に説明画像を2枚まで添付できます。</p>
            </div>
            <button
              className="shrink-0 rounded-2xl border border-black/8 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)]"
              onClick={() => referenceInputRef.current?.click()}
              type="button"
            >
              追加
            </button>
          </div>
          {pendingReferenceFiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {pendingReferenceFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="rounded-2xl bg-[var(--surface)] px-3 py-3">
                  <p className="truncate text-xs font-semibold text-[var(--ink-soft)]">{file.name}</p>
                  <button
                    className="mt-2 text-xs font-semibold text-[var(--danger)]"
                    onClick={() =>
                      setPendingReferenceFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                    }
                    type="button"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.1fr_1fr]">
            <FormField label="実行日">
              <NativePickerField
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
                disabled={form.recurrenceEnabled}
              />
            </FormField>
            <div className="min-w-0">
              <p className="mb-2 text-sm text-[var(--muted)]">時間帯</p>
              <div className="grid grid-cols-3 gap-2">
                {(["morning", "afternoon", "anytime"] as const).map((slot) => (
                  <button
                    key={slot}
                    className={selectedSlotButtonClass(selectedSlot === slot)}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        scheduledTime: slotToScheduledTime(slot),
                      }))
                    }
                    type="button"
                  >
                    {slotLabel(slot)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-[var(--muted)]">優先度</p>
            <div className="flex flex-wrap gap-2">
              {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                <button
                  key={priority}
                  className={priorityPillClass(form.priority === priority)}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      priority,
                    }))
                  }
                  type="button"
                >
                  {formatPriorityIcon(priority)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-3xl bg-[var(--surface)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">繰り返し</p>
              </div>
              <button
                className={form.recurrenceEnabled ? segmentedActiveButtonClass : segmentedButtonClass}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    recurrenceEnabled: !current.recurrenceEnabled,
                    recurrenceEndDate:
                      !current.recurrenceEnabled && !current.recurrenceEndDate
                        ? current.scheduledDate
                        : current.recurrenceEndDate,
                  }))
                }
                type="button"
              >
                {form.recurrenceEnabled ? "ON" : "OFF"}
              </button>
            </div>

            {form.recurrenceEnabled ? (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
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

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="期間開始">
                    <NativePickerField
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
                  <FormField label="期間終了">
                    <NativePickerField
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
                            className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${
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
        {isEditing && hasRecurrenceRule && onUpdateScopeChange ? (
          <div className="mt-5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3">
            <p className="text-xs font-semibold text-[var(--warning-ink)]">繰り返しタスクの変更範囲</p>
            <div className="mt-2 flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  checked={updateScope === "single"}
                  onChange={() => onUpdateScopeChange("single")}
                  className="accent-[var(--brand)]"
                />
                <span className="text-[var(--ink-soft)]">このタスクのみ変更</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  checked={updateScope === "all"}
                  onChange={() => onUpdateScopeChange("all")}
                  className="accent-[var(--brand)]"
                />
                <span className="font-semibold text-[var(--warning-ink)]">繰り返し全タスクを変更（タイトル・説明・優先度・時間帯）</span>
              </label>
            </div>
          </div>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button className={modalSecondaryButtonClass} onClick={onClose} type="button">
            閉じる
          </button>
          <button className={modalPrimaryButtonClass} onClick={onSave} type="button" disabled={isSaving}>
            {isSaving ? "処理中..." : isEditing ? "更新" : "登録"}
          </button>
        </div>
        <input
          ref={referenceInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            appendReferenceFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {content}
    </div>
  );
}

function TaskDetailModal({
  actionPending,
  task,
  onClose,
  onCopyText,
  onAction,
  onReferencePhotoUpload,
  onReferencePhotoDelete,
  onReferencePhotoReplace,
  onPhotoUpload,
  onPhotoDelete,
  onPhotoReplace,
  onPreview,
  inline = false,
}: {
  actionPending: ActionType | null;
  task: TaskRecord;
  onClose: () => void;
  onCopyText: (label: string, value: string) => Promise<void>;
  onAction: (action: ActionType) => void;
  onReferencePhotoUpload: (file: File) => void;
  onReferencePhotoDelete: (photoId: string) => void;
  onReferencePhotoReplace: (photoId: string, file: File) => void;
  onPhotoUpload: (file: File) => void;
  onPhotoDelete: (photoId: string) => void;
  onPhotoReplace: (photoId: string, file: File) => void;
  onPreview: (url: string) => void;
  inline?: boolean;
}) {
  const [isPhotoSubmitting, setIsPhotoSubmitting] = useState(false);
  const [isReferencePhotoSubmitting, setIsReferencePhotoSubmitting] = useState(false);
  const shouldOpenPhotoPickerOnDoneRef = useRef(false);
  const referencePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const completePhotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!shouldOpenPhotoPickerOnDoneRef.current || task.status !== "done") return;
    completePhotoInputRef.current?.click();
    shouldOpenPhotoPickerOnDoneRef.current = false;
  }, [task.status]);

  const content = (
      <div
        className={`overflow-y-auto rounded-[32px] bg-white ${
          inline
            ? "max-h-none px-1 py-1 shadow-none"
            : "absolute left-1/2 top-1/2 max-h-[min(88vh,820px)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 px-5 py-5 shadow-2xl lg:w-[min(94vw,980px)] lg:max-w-[980px] lg:px-7"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {inline ? null : <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-black/12" />}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-heading)] text-sm leading-6 tracking-[-0.01em] text-[var(--ink)]">
              {formatTaskTitleIcon(task)}{" "}
              {task.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {slotLabel(scheduledTimeToSlot(task.scheduled_time))} / {formatStatus(task.status)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {task.description ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--ink)]">説明</p>
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

          <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">説明画像</p>
              </div>
              {(task.reference_photos?.length ?? 0) < 2 ? (
                <button
                  className={secondaryButtonClass}
                  onClick={() => referencePhotoInputRef.current?.click()}
                  type="button"
                >
                  追加
                </button>
              ) : (
                <span className="text-xs font-semibold text-[var(--muted)]">2 / 2枚</span>
              )}
            </div>

            {task.reference_photos?.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {task.reference_photos.map((photo) => (
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
                      onClick={() => onReferencePhotoDelete(photo.id)}
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
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (!file) return;
                          setIsReferencePhotoSubmitting(true);
                          await Promise.resolve(onReferencePhotoReplace(photo.id, file));
                          setIsReferencePhotoSubmitting(false);
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">説明画像はまだありません。</p>
            )}
          </div>

          {task.recurrence?.is_active ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <p className="text-xs font-semibold text-[var(--ink)]">繰り返し</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{formatRecurrenceSummary(task)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                期間: {task.recurrence.start_date} - {task.recurrence.end_date ?? "終了日なし"}
              </p>
            </div>
          ) : null}

          {task.status !== "done" ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <p className="text-xs font-semibold text-[var(--ink)]">完了写真</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                完了写真はタスク完了後に登録できます。
              </p>
            </div>
          ) : null}

          {task.status === "done" ? (
            <div className="rounded-2xl bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[var(--ink)]">完了写真</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    最大3枚まで登録できます。
                  </p>
                </div>
                {(task.photos?.length ?? 0) < 3 ? (
                  <button
                    className={secondaryButtonClass}
                    onClick={() => completePhotoInputRef.current?.click()}
                    type="button"
                  >
                    写真追加
                  </button>
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

        <div className="mt-5 grid grid-cols-5 gap-2">
          <ActionButton
            label="開始"
            onClick={() => onAction("start")}
            tone="warning"
            disabled={!(task.status === "pending" || task.status === "awaiting_confirmation" || task.status === "done")}
            loading={actionPending === "start"}
          />
          <ActionButton
            label="中断"
            onClick={() => onAction("pause")}
            tone="neutral"
            disabled={!(task.status === "in_progress" || task.status === "awaiting_confirmation")}
            loading={actionPending === "pause"}
          />
          <ActionButton
            label="完了"
            onClick={() => onAction("complete")}
            tone="success"
            disabled={task.status === "done" || task.status === "awaiting_confirmation"}
            loading={actionPending === "complete"}
          />
          <ActionButton
            label="確認"
            onClick={() => onAction("confirm")}
            tone="warning"
            disabled={task.status !== "awaiting_confirmation"}
            loading={actionPending === "confirm"}
          />
          <ActionButton
            label="翌日"
            onClick={() => onAction("postpone")}
            tone="neutral"
            disabled={
              task.status === "done" ||
              task.status === "awaiting_confirmation" ||
              task.priority === "urgent" ||
              task.priority === "high"
            }
            loading={actionPending === "postpone"}
          />
        </div>
        {(task.priority === "urgent" || task.priority === "high") && task.status !== "done" ? (
          <div className="mt-3 rounded-2xl bg-[rgba(220,38,38,0.08)] px-4 py-3 text-center text-sm font-semibold text-[var(--danger)]">
            最優先のため延期不可
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            className={closeWideButtonClass}
            onClick={onClose}
            type="button"
          >
            閉じる
          </button>
        </div>
        <input
          ref={referencePhotoInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setIsReferencePhotoSubmitting(true);
            await Promise.resolve(onReferencePhotoUpload(file));
            setIsReferencePhotoSubmitting(false);
          }}
        />
        <input
          ref={completePhotoInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setIsPhotoSubmitting(true);
            await Promise.resolve(onPhotoUpload(file));
            setIsPhotoSubmitting(false);
          }}
        />
      </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {content}
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
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function NativePickerField({
  type,
  value,
  onChange,
  disabled = false,
}: {
  type: "date" | "time";
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  const displayValue = type === "date" ? formatDateDisplay(value) : formatTimeDisplay(value);

  return (
    <div className={`relative min-w-0 ${disabled ? "opacity-70" : ""}`}>
      <div
        className={`flex w-full min-w-0 items-center rounded-2xl border border-black/10 px-4 py-3 text-sm transition-shadow ${
          disabled ? "bg-[var(--chip)] text-[var(--muted)]" : "bg-white text-[var(--ink)]"
        }`}
      >
        <span className="truncate">{displayValue}</span>
      </div>
      <input
        aria-label={type === "date" ? "日付を選択" : "時刻を選択"}
        className="absolute inset-0 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:pointer-events-none"
        disabled={disabled}
        onChange={onChange}
        type={type}
        value={value}
      />
    </div>
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
    <footer className="mt-6 rounded-[28px] bg-white px-5 py-4 text-sm text-[var(--muted)] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
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
  "w-full max-w-full min-w-0 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none transition-shadow focus:border-[var(--brand)]/50 focus:ring-2 focus:ring-[var(--brand)]/10";
const primaryButtonClass =
  "rounded-2xl bg-[var(--brand)] px-5 py-3.5 text-sm font-semibold text-white transition-transform active:scale-[0.97]";
const primaryIconButtonClass =
  "flex h-12 w-12 items-center justify-center rounded-2xl bg-[#244234] text-2xl font-light leading-none text-white shadow-[0_4px_12px_rgba(36,66,52,0.25)] transition-transform active:scale-[0.95]";
const secondaryButtonClass =
  "rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const segmentedButtonClass =
  "rounded-xl border border-black/8 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const segmentedActiveButtonClass =
  "rounded-xl bg-[#244234] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_10px_rgba(36,66,52,0.2)] transition-transform active:scale-[0.97]";
const selectCardClass =
  "min-w-0 rounded-2xl border border-black/8 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink)] outline-none";
const squareUtilityButtonClass =
  "flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-black/8 bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const wideUtilityButtonClass =
  "flex w-full items-center justify-center rounded-2xl border border-black/8 bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const miniUtilityButtonClass =
  "rounded-xl border border-black/8 bg-white px-3 py-2 text-xs font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const miniDangerButtonClass =
  "rounded-xl border border-[var(--danger)]/25 bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[var(--danger)] transition-transform active:scale-[0.97]";
const secondaryDangerClass =
  "rounded-2xl border border-[var(--danger)] bg-white px-4 py-3 text-sm font-semibold text-[var(--danger)] transition-transform active:scale-[0.97]";
const toolbarButtonClass =
  "inline-flex items-center gap-2 rounded-2xl bg-[var(--chip)] px-5 py-3 text-sm font-semibold text-[var(--brand)] shadow-[0_4px_12px_rgba(79,70,229,0.08)]";
const toolbarDangerButtonClass =
  "inline-flex items-center gap-2 rounded-2xl border border-[var(--danger)]/20 bg-[#FEF2F2] px-5 py-3 text-sm font-semibold text-[var(--danger)] shadow-[0_4px_12px_rgba(220,38,38,0.08)]";
const bottomActionButtonClass =
  "w-full rounded-[22px] border border-[var(--brand)]/15 bg-white px-4 py-4 text-sm font-semibold text-[var(--brand)] shadow-[0_4px_12px_rgba(79,70,229,0.06)] transition-transform active:scale-[0.97]";
const iconButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-white text-sm text-[var(--ink-soft)]";
const modalPrimaryButtonClass =
  "w-full rounded-2xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.97]";
const modalSecondaryButtonClass =
  "w-full rounded-2xl border border-black/8 bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const closeWideButtonClass =
  "w-full rounded-2xl border border-black/8 bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
const desktopSecondaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-[#e2e8f0] bg-white px-3.5 py-2 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:bg-[#f8fafc] hover:border-[#cbd5e1] active:bg-[#f1f5f9]";
const desktopDangerButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-[var(--danger)]/20 bg-white px-3.5 py-2 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[#fef2f2] hover:border-[var(--danger)]/30 active:bg-[#fee2e2]";
const desktopNavButtonClass =
  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:bg-[#f1f5f9] hover:text-[var(--ink)]";
const desktopNavActiveClass =
  "flex w-full items-center gap-2 rounded-md border-l-2 border-[#244234] bg-[#f0fdf4] pl-[10px] pr-3 py-2 text-sm font-semibold text-[#244234]";

function priorityPillClass(selected: boolean) {
  return `flex h-9 w-9 items-center justify-center rounded-full border text-base transition-transform active:scale-[0.96] ${
    selected
      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
      : "border-black/8 bg-white text-[var(--ink-soft)]"
  }`;
}

function selectedSlotButtonClass(selected: boolean) {
  return selected
    ? "rounded-xl bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_10px_rgba(79,70,229,0.22)] transition-transform active:scale-[0.97]"
    : "rounded-xl border border-black/8 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition-transform active:scale-[0.97]";
}

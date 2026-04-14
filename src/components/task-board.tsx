"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AppState,
  Group,
  MembershipRequestRecord,
  TaskLogRecord,
  TaskRecord,
} from "@/lib/app-data";
import { PwaRegister } from "@/components/pwa-register";

type ActionType = "start" | "complete" | "postpone";
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

const QUEUE_STORAGE_KEY = "team-task.queue.v2";
const MEMBER_NAME_STORAGE_KEY = "team-task.member-name";

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
  if (log.action_type === "postponed_to_next_day") {
    return `${actor}さんが「${title}」を翌日に回しました`;
  }
  if (log.action_type === "priority_changed") {
    return `${actor}さんが「${title}」の優先度を変更しました`;
  }
  return `${actor}さんが「${title}」を更新しました`;
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
  const [copySourceTaskId, setCopySourceTaskId] = useState<string>("");
  const [bootstrapForm, setBootstrapForm] = useState({
    workspaceName: "",
    groupName: "",
    displayName: sessionUser?.displayName ?? "",
  });
  const [requestName, setRequestName] = useState("");
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    priority: "medium" as TaskRecord["priority"],
    scheduledDate: new Date().toISOString().slice(0, 10),
    scheduledTime: "09:00",
  });
  const [rangeStart, setRangeStart] = useState(new Date().toISOString().slice(0, 10));
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

  function openEditTask(task: TaskRecord) {
    setEditingTaskId(task.id);
    setCopySourceTaskId("");
    setTaskForm({
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      scheduledDate: task.scheduled_date,
      scheduledTime: task.scheduled_time?.slice(0, 5) ?? "09:00",
    });
    setCreateTaskOpen(true);
  }

  function openCreateTask() {
    setEditingTaskId(null);
    setCopySourceTaskId("");
    setTaskForm({
      title: "",
      description: "",
      priority: "medium",
      scheduledDate: new Date().toISOString().slice(0, 10),
      scheduledTime: "09:00",
    });
    setCreateTaskOpen(true);
  }

  function handleCopySourceChange(taskId: string) {
    setCopySourceTaskId(taskId);
    const sourceTask = state.tasks.find((task) => task.id === taskId);
    if (!sourceTask) return;

    setEditingTaskId(null);
    setTaskForm({
      title: sourceTask.title,
      description: sourceTask.description ?? "",
      priority: sourceTask.priority,
      scheduledDate: new Date().toISOString().slice(0, 10),
      scheduledTime: sourceTask.scheduled_time?.slice(0, 5) ?? "09:00",
    });
  }

  async function handleSaveTask() {
    if (!state.workspace || !taskForm.title.trim()) {
      pushToast("error", "タイトルを入力してください。");
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

  async function performTaskAction(task: TaskRecord, action: ActionType) {
    if (action === "postpone" && task.priority === "high") {
      pushToast("error", "最優先タスクは翌日に回せません。");
      return;
    }

    const optimisticTasks = state.tasks.map((item) => {
      if (item.id !== task.id) return item;
      if (action === "start") return { ...item, status: "in_progress" as const };
      if (action === "complete") return { ...item, status: "done" as const };
      return item;
    });

    const optimisticLog: TaskLogRecord = {
      id: `temp-${Date.now()}`,
      action_type:
        action === "start"
          ? "started"
          : action === "complete"
            ? "completed"
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
    <Shell appVersion={appVersion} commitSha={commitSha} toasts={toasts}>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--muted)]">{new Date().toLocaleDateString("ja-JP")}</p>
            <h1 className="mt-2 font-[family-name:var(--font-heading)] text-[2rem] leading-none tracking-[-0.03em]">
              今日のタスク
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {state.groups.find((group) => group.id === currentGroupId)?.name ?? "グループ未設定"}
            </p>
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

        <div className="mt-4 rounded-2xl bg-[var(--chip)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          {isOnline ? "オンライン" : "圏外"} / 同期状態:{" "}
          {syncState === "idle"
            ? "待機中"
            : syncState === "queued"
              ? `保留 ${queue.length}件`
              : syncState === "syncing"
                ? "同期中"
                : "要再試行"}
        </div>
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
          <Card key={task.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-start gap-2">
                  <h2 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
                    {task.status !== "done" ? `${formatPriorityIcon(task.priority)} ` : ""}
                    {task.status === "done" ? "✅ " : ""}
                    {task.title}
                  </h2>
                  <button
                    className={iconButtonClass}
                    onClick={() => copyText("タイトル", task.title)}
                    type="button"
                    aria-label="タイトルをコピー"
                  >
                    ⧉
                  </button>
                </div>
                <p className="mt-2 text-base font-medium">
                  {task.scheduled_time?.slice(0, 5) ?? "時刻未設定"}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">状態: {formatStatus(task.status)}</p>
              </div>
              <button
                className={secondaryButtonClass}
                onClick={() => openEditTask(task)}
                type="button"
              >
                編集
              </button>
            </div>

            {task.description ? (
              <div className="mt-4 flex items-start gap-2">
                <p className="flex-1 text-sm leading-7 text-[var(--ink-soft)]">{task.description}</p>
                <button
                  className={iconButtonClass}
                  onClick={() => copyText("説明", task.description ?? "")}
                  type="button"
                  aria-label="説明をコピー"
                >
                  ⧉
                </button>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {task.status === "pending" ? (
                <ActionButton
                  label="開始"
                  onClick={() => performTaskAction(task, "start")}
                  tone="warning"
                />
              ) : null}
              {task.status !== "done" ? (
                <ActionButton
                  label="完了"
                  onClick={() => performTaskAction(task, "complete")}
                  tone="success"
                />
              ) : null}
              {task.status !== "done" && task.priority !== "high" ? (
                <ActionButton
                  label="翌日に回す"
                  onClick={() => performTaskAction(task, "postpone")}
                  tone="neutral"
                />
              ) : null}
              {task.status !== "done" && task.priority === "high" ? (
                <span className="inline-flex items-center rounded-2xl border border-dashed border-[var(--danger)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">
                  最優先のため延期不可
                </span>
              ) : null}
              <button
                className="rounded-2xl border border-[var(--danger)] px-4 py-3 text-sm font-semibold text-[var(--danger)]"
                onClick={() => handleDeleteTask(task.id)}
                type="button"
              >
                削除
              </button>
            </div>
          </Card>
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
          {state.logs.map((log) => (
            <div key={log.id} className="rounded-2xl bg-[var(--chip)] px-4 py-3">
              <p className="text-sm leading-6">{logMessage(log)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(log.created_at).toLocaleString("ja-JP")}
              </p>
            </div>
          ))}
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
    </Shell>
  );
}

function Shell({
  children,
  appVersion,
  commitSha,
  toasts,
}: {
  children: React.ReactNode;
  appVersion: string;
  commitSha: string;
  toasts: Toast[];
}) {
  return (
    <>
      <PwaRegister />
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
  form: {
    title: string;
    description: string;
    priority: TaskRecord["priority"];
    scheduledDate: string;
    scheduledTime: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      title: string;
      description: string;
      priority: TaskRecord["priority"];
      scheduledDate: string;
      scheduledTime: string;
    }>
  >;
  onClose: () => void;
  onSave: () => void;
  isEditing: boolean;
  onCopySourceChange: (taskId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4">
      <div className="w-full max-w-md rounded-t-[32px] bg-white px-5 py-5 shadow-2xl">
        <h3 className="font-[family-name:var(--font-heading)] text-xl tracking-[-0.03em]">
          {isEditing ? "タスク編集" : "新しいタスク"}
        </h3>
        <div className="mt-4 grid gap-3">
          {!isEditing && availableCopyTasks.length > 0 ? (
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
      <div className="mt-2 flex items-center justify-between">
        <span>ログイン状態</span>
        <span>14日アクセスなしで自動ログアウト</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span>通知音</span>
        <span>端末標準音</span>
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

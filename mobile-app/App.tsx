import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { fetchBackendVersion } from "./src/lib/backend";
import {
  createAuthHeaders,
  createBackendUrl,
  createTask,
  exchangeMobileSession,
  fetchAppState,
  postTaskAction,
  type CreateTaskPayload,
  type MobileAppState,
  type MobileGroup,
  type MobileLogRecord,
  type MobileTaskRecord,
  type RecurrenceFrequency,
  type TaskAction,
  type TaskPhotoRecord,
} from "./src/lib/api";

WebBrowser.maybeCompleteAuthSession();

const SESSION_TOKEN_KEY = "team-task-mobile-session-token";
const APP_SCHEME = "teamtaskmobile";
const BRAND = "#1F6B52";
const SURFACE = "#F5F2EA";
const CARD = "#FFFCF7";
const BORDER = "#E7E0D4";
const TEXT = "#1E1C19";
const MUTED = "#7E766C";
const WEEKDAYS = [
  { label: "日", value: 0 },
  { label: "月", value: 1 },
  { label: "火", value: 2 },
  { label: "水", value: 3 },
  { label: "木", value: 4 },
  { label: "金", value: 5 },
  { label: "土", value: 6 },
];

type LoadState = "booting" | "logged_out" | "ready";
type DraftTask = {
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium" | "low";
  scheduledDate: string;
  scheduledTime: string;
  recurrenceEnabled: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: string;
  copiedFromTaskId: string | null;
};

function createRedirectUri() {
  return `${APP_SCHEME}://auth/callback`;
}

function createDefaultDraft(baseDate: string): DraftTask {
  return {
    title: "",
    description: "",
    priority: "medium",
    scheduledDate: baseDate,
    scheduledTime: "",
    recurrenceEnabled: false,
    recurrenceFrequency: "weekly",
    recurrenceInterval: "1",
    recurrenceEndDate: baseDate,
    recurrenceDaysOfWeek: [],
    recurrenceDayOfMonth: "1",
    copiedFromTaskId: null,
  };
}

function formatApiError(error: unknown) {
  const code = error instanceof Error ? error.message : "";

  switch (code) {
    case "HIGH_PRIORITY_CANNOT_POSTPONE":
      return "高優先度タスクは翌日に回せません。";
    case "ACTOR_NOT_FOUND":
      return "メンバー情報の取得に失敗しました。";
    case "TASK_NOT_FOUND":
      return "対象のタスクが見つかりません。";
    case "SESSION_NOT_READY":
      return "ログイン処理が完了していません。";
    case "SESSION_EXPIRED":
      return "ログイン期限が切れました。もう一度ログインしてください。";
    case "UNAUTHORIZED":
    case "HTTP_401":
      return "認証が切れました。再ログインしてください。";
    case "INVALID_INPUT":
      return "入力内容が不足しています。";
    case "INVALID_RECURRENCE":
      return "繰り返し設定が不足しています。";
    case "INVALID_RECURRENCE_PERIOD":
      return "繰り返しの終了日は開始日以降にしてください。";
    default:
      return "通信に失敗しました。ネットワーク状態を確認してください。";
  }
}

function formatTaskDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function buildTodayLabel() {
  return new Date().toISOString().slice(0, 10);
}

function compareTaskOrder(left: MobileTaskRecord, right: MobileTaskRecord) {
  const priorityRank = (task: MobileTaskRecord) => {
    if (task.status === "done") {
      return 4;
    }

    if (task.priority === "urgent") {
      return 0;
    }

    if (task.priority === "high") {
      return 1;
    }

    if (task.priority === "medium") {
      return 2;
    }

    return 3;
  };

  const rankDiff = priorityRank(left) - priorityRank(right);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const leftTime = left.scheduled_time ?? "99:99";
  const rightTime = right.scheduled_time ?? "99:99";
  return leftTime.localeCompare(rightTime);
}

function statusLabel(status: MobileTaskRecord["status"]) {
  switch (status) {
    case "pending":
      return "未着手";
    case "in_progress":
      return "作業中";
    case "awaiting_confirmation":
      return "確認待ち";
    case "done":
      return "完了";
    default:
      return "保留";
  }
}

function actionLabel(action: TaskAction) {
  switch (action) {
    case "start":
      return "開始";
    case "confirm":
      return "確認待ち";
    case "complete":
      return "完了";
    case "pause":
      return "中断";
    case "postpone":
      return "翌日";
  }
}

function logMessage(log: MobileLogRecord) {
  const actor = log.actor?.display_name ?? "誰か";
  const title = log.task?.title ?? "タスク";

  switch (log.action_type) {
    case "started":
      return `${actor}が「${title}」を開始`;
    case "completed":
      return `${actor}が「${title}」を完了`;
    case "confirm_requested":
      return `${actor}が「${title}」を確認待ち`;
    case "postponed_to_next_day":
      return `${actor}が「${title}」を翌日に移動`;
    case "created":
      return `${actor}が「${title}」を登録`;
    default:
      return `${actor}が「${title}」を更新`;
  }
}

function groupName(groups: MobileGroup[], groupId: string | null) {
  if (!groupId) {
    return "個人";
  }

  return groups.find((group) => group.id === groupId)?.name ?? "グループ";
}

function taskTitle(task: MobileTaskRecord) {
  return task.status === "done" ? `✅ ${task.title}` : task.title;
}

function priorityLabel(priority: MobileTaskRecord["priority"]) {
  switch (priority) {
    case "urgent":
      return "緊急";
    case "high":
      return "高";
    case "medium":
      return "中";
    default:
      return "低";
  }
}

function TaskPreviewImage({
  photo,
  sessionToken,
}: {
  photo: TaskPhotoRecord;
  sessionToken: string;
}) {
  if (!photo.preview_url) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image
      source={{
        uri: createBackendUrl(photo.preview_url),
        headers: createAuthHeaders(sessionToken),
      }}
      style={styles.previewImage}
      resizeMode="cover"
    />
  );
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [appState, setAppState] = useState<MobileAppState | null>(null);
  const [backendVersion, setBackendVersion] = useState<{ appVersion: string; commitSha: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [draftTask, setDraftTask] = useState<DraftTask>(() => createDefaultDraft(buildTodayLabel()));
  const appStateRef = useRef(AppState.currentState);

  const loadBackendVersion = useCallback(async () => {
    try {
      const version = await fetchBackendVersion();
      setBackendVersion({
        appVersion: version.appVersion,
        commitSha: version.commitSha,
      });
    } catch {
      setBackendVersion(null);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const storedToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);

    if (!storedToken) {
      setSessionToken(null);
      setAppState(null);
      setLoadState("logged_out");
      return;
    }

    setSessionToken(storedToken);

    try {
      const response = await fetchAppState(storedToken);
      setAppState(response.state);
      setLoadState("ready");
      setErrorMessage(null);
    } catch (error) {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
      setSessionToken(null);
      setAppState(null);
      setLoadState("logged_out");
      setErrorMessage(formatApiError(error));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadBackendVersion();
      await loadSession();
    })();
  }, [loadBackendVersion, loadSession]);

  const refreshData = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    setRefreshing(true);

    try {
      const response = await fetchAppState(sessionToken);
      setAppState(response.state);
      setErrorMessage(null);
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setRefreshing(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackground = appStateRef.current !== "active";
      appStateRef.current = nextState;

      if (nextState === "active" && wasBackground) {
        void loadBackendVersion();
        if (sessionToken) {
          void refreshData();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadBackendVersion, refreshData, sessionToken]);

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    setErrorMessage(null);

    try {
      const redirectUri = createRedirectUri();
      const startUrl = createBackendUrl(
        `/api/auth/mobile/line/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
      );

      const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);

      if (result.type !== "success" || !result.url) {
        throw new Error("LOGIN_CANCELLED");
      }

      const url = new URL(result.url);
      const requestId = url.searchParams.get("request_id");
      const error = url.searchParams.get("error");

      if (error) {
        throw new Error(error);
      }

      if (!requestId) {
        throw new Error("SESSION_NOT_READY");
      }

      const exchange = await exchangeMobileSession(requestId);
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, exchange.sessionToken);
      setSessionToken(exchange.sessionToken);

      const response = await fetchAppState(exchange.sessionToken);
      setAppState(response.state);
      setLoadState("ready");
    } catch (error) {
      if (!(error instanceof Error && error.message === "LOGIN_CANCELLED")) {
        setErrorMessage(formatApiError(error));
      }
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    setSessionToken(null);
    setAppState(null);
    setActiveTaskId(null);
    setLoadState("logged_out");
  }, []);

  const handleTaskAction = useCallback(
    async (taskId: string, action: TaskAction) => {
      if (!sessionToken) {
        return;
      }

      setActingTaskId(taskId);
      setErrorMessage(null);

      try {
        await postTaskAction(taskId, action, sessionToken);
        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setActingTaskId(null);
      }
    },
    [refreshData, sessionToken],
  );

  const today = useMemo(buildTodayLabel, []);
  const primaryGroup = useMemo(() => appState?.groups[0] ?? null, [appState?.groups]);

  const todayTasks = useMemo(() => {
    if (!appState) {
      return [];
    }

    return appState.tasks
      .filter((task) => task.scheduled_date === today)
      .sort(compareTaskOrder);
  }, [appState, today]);

  const selectedTask = useMemo(
    () => todayTasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, todayTasks],
  );

  const summary = useMemo(() => {
    return {
      pending: todayTasks.filter((task) => task.status === "pending").length,
      inProgress: todayTasks.filter((task) => task.status === "in_progress").length,
      awaitingConfirmation: todayTasks.filter(
        (task) => task.status === "awaiting_confirmation",
      ).length,
      done: todayTasks.filter((task) => task.status === "done").length,
    };
  }, [todayTasks]);

  const copyableTasks = useMemo(
    () => (appState?.tasks ?? []).slice().sort(compareTaskOrder).slice(0, 12),
    [appState?.tasks],
  );

  const openCreateModal = useCallback(() => {
    setDraftTask(createDefaultDraft(today));
    setCreateModalVisible(true);
  }, [today]);

  const applyCopiedTask = useCallback(
    (taskId: string) => {
      const sourceTask = copyableTasks.find((task) => task.id === taskId);
      if (!sourceTask) {
        return;
      }

      setDraftTask((current) => ({
        ...current,
        copiedFromTaskId: sourceTask.id,
        title: sourceTask.title,
        description: sourceTask.description ?? "",
        priority: sourceTask.priority,
        scheduledTime: sourceTask.scheduled_time ?? "",
        recurrenceEnabled: Boolean(sourceTask.recurrence),
        recurrenceFrequency: sourceTask.recurrence?.frequency ?? "weekly",
        recurrenceInterval: String(sourceTask.recurrence?.interval_value ?? 1),
        recurrenceEndDate: sourceTask.recurrence?.end_date ?? current.scheduledDate,
        recurrenceDaysOfWeek: sourceTask.recurrence?.days_of_week ?? [],
        recurrenceDayOfMonth: String(sourceTask.recurrence?.day_of_month ?? 1),
      }));
    },
    [copyableTasks],
  );

  const toggleRecurrenceWeekday = useCallback((day: number) => {
    setDraftTask((current) => ({
      ...current,
      recurrenceDaysOfWeek: current.recurrenceDaysOfWeek.includes(day)
        ? current.recurrenceDaysOfWeek.filter((value) => value !== day)
        : current.recurrenceDaysOfWeek.concat(day).sort(),
    }));
  }, []);

  const saveTask = useCallback(async () => {
    if (!sessionToken || !appState?.workspace) {
      return;
    }

    const normalizedTitle = draftTask.title.trim();
    if (!normalizedTitle) {
      setErrorMessage("タスク名を入力してください。");
      return;
    }

    const interval = Number(draftTask.recurrenceInterval || "1");
    const dayOfMonth = Number(draftTask.recurrenceDayOfMonth || "1");

    const payload: CreateTaskPayload = {
      workspaceId: appState.workspace.id,
      title: normalizedTitle,
      description: draftTask.description.trim(),
      priority: draftTask.priority,
      scheduledDate: draftTask.scheduledDate,
      scheduledTime: draftTask.scheduledTime || null,
      visibilityType: primaryGroup ? "group" : "personal",
      groupId: primaryGroup?.id ?? null,
      recurrence: {
        enabled: draftTask.recurrenceEnabled,
        frequency: draftTask.recurrenceEnabled ? draftTask.recurrenceFrequency : undefined,
        interval: draftTask.recurrenceEnabled ? Math.max(1, interval || 1) : undefined,
        endDate: draftTask.recurrenceEnabled ? draftTask.recurrenceEndDate : undefined,
        daysOfWeek:
          draftTask.recurrenceEnabled && draftTask.recurrenceFrequency === "weekly"
            ? draftTask.recurrenceDaysOfWeek
            : undefined,
        dayOfMonth:
          draftTask.recurrenceEnabled && draftTask.recurrenceFrequency === "monthly"
            ? Math.min(31, Math.max(1, dayOfMonth || 1))
            : null,
      },
    };

    setSavingTask(true);
    setErrorMessage(null);

    try {
      await createTask(payload, sessionToken);
      setCreateModalVisible(false);
      setDraftTask(createDefaultDraft(today));
      await refreshData();
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setSavingTask(false);
    }
  }, [appState?.workspace, draftTask, primaryGroup, refreshData, sessionToken, today]);

  if (loadState === "booting") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ExpoStatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
          <Text style={styles.bootText}>読み込み中</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === "logged_out") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ExpoStatusBar style="dark" />
        <View style={styles.loginScreen}>
          <Text style={styles.eyebrow}>TEAM TASK NATIVE</Text>
          <Text style={styles.loginTitle}>LINEでログイン</Text>
          <Text style={styles.loginDescription}>
            ブラウザ表示ではなく、Expo ネイティブ画面から直接タスクを扱う構成です。
          </Text>

          <Pressable
            style={[styles.primaryButton, loggingIn && styles.primaryButtonDisabled]}
            onPress={() => void handleLogin()}
            disabled={loggingIn}
          >
            {loggingIn ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>LINEログインを開始</Text>
            )}
          </Pressable>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.versionCard}>
            <Text style={styles.versionLabel}>接続先</Text>
            <Text style={styles.versionValue}>{backendVersion?.appVersion ?? "-"}</Text>
            <Text style={styles.versionCommit}>{backendVersion?.commitSha ?? "-"}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ExpoStatusBar style="dark" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshData()} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.eyebrow}>TASK BOARD</Text>
              <Text style={styles.heroTitle}>{formatTaskDateLabel(today)}</Text>
              <Text style={styles.heroSubtitle}>
                {primaryGroup?.name ?? appState?.workspace?.name ?? "ワークスペース未設定"}
              </Text>
            </View>
            <Pressable style={styles.fabButton} onPress={openCreateModal}>
              <Text style={styles.fabButtonText}>＋</Text>
            </Pressable>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>未着手</Text>
              <Text style={styles.summaryValue}>{summary.pending}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryWarm]}>
              <Text style={styles.summaryLabel}>作業中</Text>
              <Text style={styles.summaryValue}>{summary.inProgress}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryWarm]}>
              <Text style={styles.summaryLabel}>確認待ち</Text>
              <Text style={styles.summaryValue}>{summary.awaitingConfirmation}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryDone]}>
              <Text style={styles.summaryLabel}>完了</Text>
              <Text style={styles.summaryValue}>{summary.done}</Text>
            </View>
          </View>
        </View>

        {errorMessage ? (
          <View style={styles.inlineErrorCard}>
            <Text style={styles.inlineErrorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>本日のタスク</Text>
            <Pressable onPress={() => void handleLogout()}>
              <Text style={styles.linkText}>ログアウト</Text>
            </Pressable>
          </View>

          {todayTasks.length === 0 ? (
            <Text style={styles.emptyText}>今日のタスクはありません。</Text>
          ) : (
            todayTasks.map((task) => (
              <Pressable
                key={task.id}
                style={styles.taskCard}
                onPress={() => setActiveTaskId(task.id)}
              >
                <View style={styles.taskHeader}>
                  <View style={styles.taskTitleWrap}>
                    <Text style={styles.taskTitle}>{taskTitle(task)}</Text>
                    <Text style={styles.taskMeta}>
                      {task.scheduled_time ? `${task.scheduled_time} / ` : ""}
                      {groupName(appState?.groups ?? [], task.group_id)}
                    </Text>
                  </View>
                  <View style={styles.taskBadgeWrap}>
                    <Text style={styles.statusChip}>{statusLabel(task.status)}</Text>
                  </View>
                </View>
                {task.description ? (
                  <Text style={styles.taskDescription} numberOfLines={2}>
                    {task.description}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>通知</Text>
          {appState?.logs?.length ? (
            appState.logs.slice(0, 5).map((log) => (
              <View key={log.id} style={styles.logBubble}>
                {log.actor?.line_picture_url ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image source={{ uri: log.actor.line_picture_url }} style={styles.logAvatar} />
                ) : (
                  <View style={styles.logAvatarFallback}>
                    <Text style={styles.logAvatarFallbackText}>
                      {(log.actor?.display_name ?? "?").slice(0, 1)}
                    </Text>
                  </View>
                )}
                <View style={styles.logBody}>
                  <Text style={styles.logActor}>{log.actor?.display_name ?? "誰か"}</Text>
                  <Text style={styles.logText}>{logMessage(log)}</Text>
                  <Text style={styles.logTime}>
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(log.created_at))}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>新しい通知はありません。</Text>
          )}
        </View>

        <View style={styles.versionFooter}>
          <Text style={styles.versionFooterText}>
            {backendVersion?.appVersion ?? "-"} ({backendVersion?.commitSha ?? "-"})
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedTask)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveTaskId(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActiveTaskId(null)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            {selectedTask ? (
              <>
                <Text style={styles.modalTitle}>{taskTitle(selectedTask)}</Text>
                <Text style={styles.modalMeta}>
                  {selectedTask.scheduled_time ? `${selectedTask.scheduled_time} / ` : ""}
                  {statusLabel(selectedTask.status)}
                </Text>
                {selectedTask.description ? (
                  <Text style={styles.modalDescription}>{selectedTask.description}</Text>
                ) : null}

                {selectedTask.reference_photos?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewStrip}>
                    {selectedTask.reference_photos.map((photo) => (
                      <TaskPreviewImage
                        key={photo.id}
                        photo={photo}
                        sessionToken={sessionToken ?? ""}
                      />
                    ))}
                  </ScrollView>
                ) : null}

                <View style={styles.actionGrid}>
                  {(["start", "confirm", "complete", "pause", "postpone"] as TaskAction[]).map(
                    (action) => (
                      <Pressable
                        key={action}
                        style={[
                          styles.actionButton,
                          actingTaskId === selectedTask.id && styles.actionButtonDisabled,
                        ]}
                        onPress={() => void handleTaskAction(selectedTask.id, action)}
                        disabled={actingTaskId === selectedTask.id}
                      >
                        <Text style={styles.actionButtonText}>{actionLabel(action)}</Text>
                      </Pressable>
                    ),
                  )}
                </View>

                <Pressable style={styles.closeButton} onPress={() => setActiveTaskId(null)}>
                  <Text style={styles.closeButtonText}>閉じる</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.largeModalCard]} onPress={() => null}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>タスクを追加</Text>
              <Text style={styles.modalMeta}>
                追加先: {primaryGroup ? `${primaryGroup.name} に共有` : "個人タスク"}
              </Text>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>既存タスクをコピー</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {copyableTasks.map((task) => (
                    <Pressable
                      key={task.id}
                      style={[
                        styles.copyTaskChip,
                        draftTask.copiedFromTaskId === task.id && styles.copyTaskChipActive,
                      ]}
                      onPress={() => applyCopiedTask(task.id)}
                    >
                      <Text
                        style={[
                          styles.copyTaskChipText,
                          draftTask.copiedFromTaskId === task.id && styles.copyTaskChipTextActive,
                        ]}
                      >
                        {task.title}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>タイトル</Text>
                <TextInput
                  value={draftTask.title}
                  onChangeText={(title) => setDraftTask((current) => ({ ...current, title }))}
                  placeholder="タスク名"
                  placeholderTextColor="#A59C91"
                  style={styles.textInput}
                />
              </View>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>説明</Text>
                <TextInput
                  value={draftTask.description}
                  onChangeText={(description) =>
                    setDraftTask((current) => ({ ...current, description }))
                  }
                  placeholder="説明"
                  placeholderTextColor="#A59C91"
                  style={[styles.textInput, styles.multilineInput]}
                  multiline
                />
              </View>

              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <Text style={styles.fieldLabel}>日付</Text>
                  <TextInput
                    value={draftTask.scheduledDate}
                    onChangeText={(scheduledDate) =>
                      setDraftTask((current) => ({ ...current, scheduledDate }))
                    }
                    placeholder="2026-04-15"
                    placeholderTextColor="#A59C91"
                    style={styles.textInput}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.formColumn}>
                  <Text style={styles.fieldLabel}>時刻</Text>
                  <TextInput
                    value={draftTask.scheduledTime}
                    onChangeText={(scheduledTime) =>
                      setDraftTask((current) => ({ ...current, scheduledTime }))
                    }
                    placeholder="09:00"
                    placeholderTextColor="#A59C91"
                    style={styles.textInput}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>優先度</Text>
                <View style={styles.optionRow}>
                  {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                    <Pressable
                      key={priority}
                      style={[
                        styles.choiceChip,
                        draftTask.priority === priority && styles.choiceChipActive,
                      ]}
                      onPress={() => setDraftTask((current) => ({ ...current, priority }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          draftTask.priority === priority && styles.choiceChipTextActive,
                        ]}
                      >
                        {priorityLabel(priority)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>繰り返し</Text>
                  <Pressable
                    style={[
                      styles.toggleButton,
                      draftTask.recurrenceEnabled && styles.toggleButtonActive,
                    ]}
                    onPress={() =>
                      setDraftTask((current) => ({
                        ...current,
                        recurrenceEnabled: !current.recurrenceEnabled,
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.toggleButtonText,
                        draftTask.recurrenceEnabled && styles.toggleButtonTextActive,
                      ]}
                    >
                      {draftTask.recurrenceEnabled ? "ON" : "OFF"}
                    </Text>
                  </Pressable>
                </View>

                {draftTask.recurrenceEnabled ? (
                  <>
                    <View style={styles.optionRow}>
                      {(["daily", "weekly", "monthly"] as RecurrenceFrequency[]).map((frequency) => (
                        <Pressable
                          key={frequency}
                          style={[
                            styles.choiceChip,
                            draftTask.recurrenceFrequency === frequency && styles.choiceChipActive,
                          ]}
                          onPress={() =>
                            setDraftTask((current) => ({
                              ...current,
                              recurrenceFrequency: frequency,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.choiceChipText,
                              draftTask.recurrenceFrequency === frequency &&
                                styles.choiceChipTextActive,
                            ]}
                          >
                            {frequency === "daily"
                              ? "毎日"
                              : frequency === "weekly"
                                ? "毎週"
                                : "毎月"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.formRow}>
                      <View style={styles.formColumn}>
                        <Text style={styles.fieldLabel}>間隔</Text>
                        <TextInput
                          value={draftTask.recurrenceInterval}
                          onChangeText={(recurrenceInterval) =>
                            setDraftTask((current) => ({ ...current, recurrenceInterval }))
                          }
                          placeholder="1"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          keyboardType="number-pad"
                        />
                      </View>
                      <View style={styles.formColumn}>
                        <Text style={styles.fieldLabel}>終了日</Text>
                        <TextInput
                          value={draftTask.recurrenceEndDate}
                          onChangeText={(recurrenceEndDate) =>
                            setDraftTask((current) => ({ ...current, recurrenceEndDate }))
                          }
                          placeholder="2026-05-15"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          autoCapitalize="none"
                        />
                      </View>
                    </View>

                    {draftTask.recurrenceFrequency === "weekly" ? (
                      <View style={styles.optionRow}>
                        {WEEKDAYS.map((day) => (
                          <Pressable
                            key={day.value}
                            style={[
                              styles.weekdayChip,
                              draftTask.recurrenceDaysOfWeek.includes(day.value) &&
                                styles.choiceChipActive,
                            ]}
                            onPress={() => toggleRecurrenceWeekday(day.value)}
                          >
                            <Text
                              style={[
                                styles.choiceChipText,
                                draftTask.recurrenceDaysOfWeek.includes(day.value) &&
                                  styles.choiceChipTextActive,
                              ]}
                            >
                              {day.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {draftTask.recurrenceFrequency === "monthly" ? (
                      <View style={styles.formSection}>
                        <Text style={styles.fieldLabel}>毎月の日付</Text>
                        <TextInput
                          value={draftTask.recurrenceDayOfMonth}
                          onChangeText={(recurrenceDayOfMonth) =>
                            setDraftTask((current) => ({ ...current, recurrenceDayOfMonth }))
                          }
                          placeholder="1"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          keyboardType="number-pad"
                        />
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>

              <View style={styles.modalActionRow}>
                <Pressable
                  style={styles.secondaryModalButton}
                  onPress={() => setCreateModalVisible(false)}
                >
                  <Text style={styles.secondaryModalButtonText}>閉じる</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.modalPrimaryButton]}
                  onPress={() => void saveTask()}
                  disabled={savingTask}
                >
                  {savingTask ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>登録</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SURFACE,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 18,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  bootText: {
    color: MUTED,
    fontSize: 15,
  },
  loginScreen: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 18,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: MUTED,
  },
  loginTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: TEXT,
  },
  loginDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: MUTED,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  versionCard: {
    borderRadius: 22,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 4,
  },
  versionLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  versionValue: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  versionCommit: {
    color: MUTED,
    fontSize: 13,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 22,
    gap: 10,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroTitleWrap: {
    flex: 1,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 36,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: MUTED,
    fontSize: 15,
  },
  fabButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
  },
  fabButtonText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginTop: -2,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  summaryCard: {
    width: "47.5%",
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: "#F0EEE8",
    padding: 14,
    justifyContent: "space-between",
  },
  summaryWarm: {
    backgroundColor: "#F7ECD9",
  },
  summaryDone: {
    backgroundColor: "#E2F3E9",
  },
  summaryLabel: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  summaryValue: {
    color: TEXT,
    fontSize: 32,
    fontWeight: "800",
  },
  inlineErrorCard: {
    borderRadius: 18,
    backgroundColor: "#FFF1EF",
    borderWidth: 1,
    borderColor: "#F1C9C1",
    padding: 16,
  },
  inlineErrorText: {
    color: "#9E4133",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionCard: {
    borderRadius: 28,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "800",
  },
  linkText: {
    color: BRAND,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  taskCard: {
    borderRadius: 20,
    backgroundColor: "#F5F2EA",
    padding: 16,
    gap: 10,
  },
  taskHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  taskTitleWrap: {
    flex: 1,
    gap: 6,
  },
  taskTitle: {
    color: TEXT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  taskMeta: {
    color: MUTED,
    fontSize: 13,
  },
  taskBadgeWrap: {
    alignItems: "flex-end",
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#ECE7DD",
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  taskDescription: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  logBubble: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 22,
    backgroundColor: "#EEF1EB",
    padding: 14,
    alignItems: "flex-start",
  },
  logAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  logAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9E5DB",
  },
  logAvatarFallbackText: {
    color: TEXT,
    fontWeight: "700",
  },
  logBody: {
    flex: 1,
    gap: 2,
  },
  logActor: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  logText: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
  },
  logTime: {
    color: MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  versionFooter: {
    alignItems: "center",
  },
  versionFooterText: {
    color: MUTED,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 12, 11, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 26,
    backgroundColor: CARD,
    padding: 22,
    gap: 12,
  },
  largeModalCard: {
    maxHeight: "86%",
  },
  modalTitle: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "800",
  },
  formSection: {
    gap: 8,
    marginTop: 14,
  },
  formRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  formColumn: {
    flex: 1,
    gap: 8,
  },
  fieldLabel: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  textInput: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#F5F2EA",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 92,
    paddingTop: 14,
    textAlignVertical: "top",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  weekdayChip: {
    minWidth: 42,
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  choiceChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  choiceChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  choiceChipTextActive: {
    color: "#FFFFFF",
  },
  copyTaskChip: {
    maxWidth: 220,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: "#F5F2EA",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copyTaskChipActive: {
    backgroundColor: "#E5F1EA",
    borderColor: BRAND,
  },
  copyTaskChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "600",
  },
  copyTaskChipTextActive: {
    color: BRAND,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleButton: {
    minWidth: 68,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  toggleButtonActive: {
    borderColor: BRAND,
    backgroundColor: "#E5F1EA",
  },
  toggleButtonText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  toggleButtonTextActive: {
    color: BRAND,
  },
  modalActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    marginBottom: 8,
  },
  secondaryModalButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#EEE8DC",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryModalButtonText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  modalPrimaryButton: {
    flex: 1,
  },
  modalMeta: {
    color: MUTED,
    fontSize: 14,
  },
  modalDescription: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
  previewStrip: {
    marginTop: 4,
  },
  previewImage: {
    width: 104,
    height: 104,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: "#ECE7DD",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    minWidth: "31%",
    borderRadius: 16,
    backgroundColor: BRAND,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  closeButton: {
    marginTop: 2,
    borderRadius: 16,
    backgroundColor: "#EEE8DC",
    paddingVertical: 12,
    alignItems: "center",
  },
  closeButtonText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#9E4133",
    fontSize: 14,
    lineHeight: 20,
  },
});

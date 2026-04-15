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
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { fetchBackendVersion } from "./src/lib/backend";
import {
  createAuthHeaders,
  createBackendUrl,
  exchangeMobileSession,
  fetchAppState,
  postTaskAction,
  type MobileAppState,
  type MobileGroup,
  type MobileLogRecord,
  type MobileTaskRecord,
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

type LoadState = "booting" | "logged_out" | "ready";

function createRedirectUri() {
  return `${APP_SCHEME}://auth/callback`;
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
          <Text style={styles.eyebrow}>TASK BOARD</Text>
          <Text style={styles.heroTitle}>{formatTaskDateLabel(today)}</Text>
          <Text style={styles.heroSubtitle}>
            {appState?.workspace?.name ?? "ワークスペース未設定"}
          </Text>

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
  heroTitle: {
    color: TEXT,
    fontSize: 36,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: MUTED,
    fontSize: 15,
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
  modalTitle: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "800",
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

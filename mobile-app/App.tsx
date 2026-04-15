import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { mobileEnv, formatHostLabel } from "./src/config/env";
import { fetchBackendVersion } from "./src/lib/backend";
import "./src/lib/supabase";

export default function App() {
  const [backendState, setBackendState] = useState<{
    loading: boolean;
    version: string | null;
    commitSha: string | null;
    error: string | null;
  }>({
    loading: true,
    version: null,
    commitSha: null,
    error: null,
  });

  const supabaseHost = useMemo(() => formatHostLabel(mobileEnv.supabaseUrl), []);
  const webHost = useMemo(() => formatHostLabel(mobileEnv.webAppUrl), []);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendVersion() {
      try {
        const result = await fetchBackendVersion();
        if (cancelled) return;

        setBackendState({
          loading: false,
          version: result.appVersion,
          commitSha: result.commitSha,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;

        setBackendState({
          loading: false,
          version: null,
          commitSha: null,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    void loadBackendVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>TEAM TASK MOBILE</Text>
          <Text style={styles.title}>Expo版の土台を追加</Text>
          <Text style={styles.body}>
            現行のPWAを運用しながら、同じSupabaseとWeb APIを使うReact Native版を並行開発する構成です。
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>接続先</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Supabase</Text>
            <Text style={styles.infoValue}>{supabaseHost}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Web API</Text>
            <Text style={styles.infoValue}>{webHost}</Text>
          </View>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void Linking.openURL(mobileEnv.webAppUrl)}
          >
            <Text style={styles.secondaryButtonText}>現行PWAを開く</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>バックエンド疎通</Text>
          {backendState.loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#1f7a53" />
              <Text style={styles.body}>Web側の `/api/version` を確認しています。</Text>
            </View>
          ) : backendState.error ? (
            <Text style={styles.errorText}>接続失敗: {backendState.error}</Text>
          ) : (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>web version</Text>
                <Text style={styles.infoValue}>{backendState.version}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>commit</Text>
                <Text style={styles.infoValue}>{backendState.commitSha}</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>初期スコープ</Text>
          <Text style={styles.checkItem}>1. LINEログイン導線のネイティブ化</Text>
          <Text style={styles.checkItem}>2. 今日のタスク一覧 / 詳細表示</Text>
          <Text style={styles.checkItem}>3. 開始 / 確認待ち / 完了の状態変更</Text>
          <Text style={styles.checkItem}>4. 写真登録とPush通知の移植</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>次の作業</Text>
          <Text style={styles.body}>
            次段階では Expo 側へ LINE ログインとセッション保存を追加し、その後にホーム画面のタスク一覧へ進めます。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f1ea",
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 28,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: "#ffffff",
    padding: 20,
    shadowColor: "#1f2933",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#ffffff",
    padding: 18,
    gap: 12,
    shadowColor: "#1f2933",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  eyebrow: {
    color: "#1f7a53",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 8,
    color: "#1f2933",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 34,
  },
  cardTitle: {
    color: "#1f2933",
    fontSize: 18,
    fontWeight: "700",
  },
  body: {
    color: "#52606d",
    fontSize: 15,
    lineHeight: 24,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  infoLabel: {
    color: "#7b8794",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  infoValue: {
    flexShrink: 1,
    color: "#1f2933",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  secondaryButton: {
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#1f2933",
    fontSize: 14,
    fontWeight: "700",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: {
    color: "#c23b3b",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },
  checkItem: {
    color: "#1f2933",
    fontSize: 15,
    lineHeight: 24,
  },
});

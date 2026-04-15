# Team Task Mobile

Expo ベースの React Native 版です。現行の `web/` PWA を運用しながら、同じ Supabase / Web API を使う次世代クライアントとして並行開発します。

## 初回セットアップ

1. `mobile-app/.env.example` を `mobile-app/.env.local` にコピー
2. 以下を設定
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_WEB_APP_URL`
3. 起動

```bash
cd mobile-app
npm install
npm run start
```

## 今の状態

- Expo アプリの土台を追加済み
- Supabase クライアントを初期化済み
- 現行 Web バックエンドの `/api/version` 疎通確認を実装済み
- まだ LINE ログインとタスク一覧は未移植

## 次の実装順

1. LINE ログインとセッション保存
2. 今日のタスク一覧
3. タスク詳細と状態更新
4. 写真登録
5. Push 通知

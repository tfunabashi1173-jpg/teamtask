# Team Task Web

Team Task の Web/PWA クライアントです。

## 方針

- Next.js App Router
- TypeScript
- Turbopack 必須
- スマホ中心の PWA
- オフライン時は端末に操作を一時保存し、復帰後に同期

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

このプロジェクトでは `dev` と `build` の両方で Turbopack を使います。

## Environment Variables

`.env.example` をコピーして `.env.local` を作成し、以下を設定します。

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_REDIRECT_URI`
- `APP_SESSION_SECRET` 任意

## 実装済みのプロトタイプ範囲

- 今日のタスク一覧 UI
- `開始` `完了` `翌日に回す`
- 最優先タスクは延期不可
- 完了済みは `✅` 表示
- オフライン検知
- オフライン時の操作キュー保存
- 操作失敗時のエラー表示
- manifest / service worker による PWA 基盤
- アプリ版とコミットSHA表示の土台

## 注意

ローカルや通常環境では Turbopack を前提に使う。
ただし、強いサンドボックス制約がある一部実行環境では、Turbopack のビルド確認時に環境起因エラーが出る場合がある。
その場合でも、プロジェクト方針自体は Turbopack 必須とする。

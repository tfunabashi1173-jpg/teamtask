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
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TASK_PHOTO_BUCKET` 省略時は `task-photos`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `CRON_SECRET`
- `APP_SESSION_SECRET` 任意

## 実装済みのプロトタイプ範囲

- 今日のタスク一覧 UI
- `開始` `完了` `翌日に回す`
- 最優先タスクは延期不可
- 完了済みは `✅` 表示
- 完了から7日を過ぎたタスクは、保存画像を含めて自動削除
- オフライン検知
- オフライン時の操作キュー保存
- 操作失敗時のエラー表示
- manifest / service worker による PWA 基盤
- Web Push 購読登録
- タスク操作時のプッシュ通知
- アプリ版とコミットSHA表示の土台

## Morning Notifications

Vercel Hobby では高頻度 Cron を使えないため、朝通知の定期実行は GitHub Actions で行う。
ワークフローは毎時実行だが、サーバー側では各ワークスペースの通知時刻から 90 分以内を送信対象として扱うため、
`08:30` のような分指定でも次の実行タイミングで拾える。
また、`workspace_id + target_date` 単位で送信済みを記録し、同日の二重送信を防ぐ。

必要な GitHub Secrets:

- `APP_BASE_URL` 例: `https://teamtask-nexus.vercel.app`
- `CRON_SECRET` Vercel 側と同じ値

## 注意

ローカルや通常環境では Turbopack を前提に使う。
ただし、強いサンドボックス制約がある一部実行環境では、Turbopack のビルド確認時に環境起因エラーが出る場合がある。
その場合でも、プロジェクト方針自体は Turbopack 必須とする。

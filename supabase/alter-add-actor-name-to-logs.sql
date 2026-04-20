-- actor_nameをtask_activity_logsに追加し、
-- ユーザー削除後もログが残るようにactor_user_idをON DELETE SET NULLに変更する

-- 1. actor_name列を追加
ALTER TABLE public.task_activity_logs
  ADD COLUMN IF NOT EXISTS actor_name text;

-- 2. actor_user_idをNULL許容に変更
ALTER TABLE public.task_activity_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

-- 3. FK制約をON DELETE SET NULLに付け替え
ALTER TABLE public.task_activity_logs
  DROP CONSTRAINT IF EXISTS task_activity_logs_actor_user_id_fkey;

ALTER TABLE public.task_activity_logs
  ADD CONSTRAINT task_activity_logs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id)
  REFERENCES public.app_users(id)
  ON DELETE SET NULL;

-- 4. 既存レコードのactor_nameを既存ユーザーから埋める
UPDATE public.task_activity_logs l
SET actor_name = u.display_name
FROM public.app_users u
WHERE l.actor_user_id = u.id
  AND l.actor_name IS NULL;

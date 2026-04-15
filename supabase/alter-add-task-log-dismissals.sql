create table if not exists public.task_log_dismissals (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.task_activity_logs(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (log_id, user_id)
);

create index if not exists task_log_dismissals_user_created_at_idx
  on public.task_log_dismissals (user_id, created_at desc);

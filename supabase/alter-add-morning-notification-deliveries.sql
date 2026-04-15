create table if not exists public.morning_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_date date not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, target_date)
);

-- Add optional second notification time (evening reminder for incomplete tasks)
alter table public.workspaces
  add column if not exists notification_time_2 time default null;

-- Delivery log for evening notifications (prevents duplicate sends per day)
create table if not exists public.evening_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_date date not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, target_date)
);

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Tokyo',
  notification_time time not null default '08:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  email text,
  phone_number text,
  role text not null default 'member' check (role in ('admin', 'member')),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.member_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_by_user_id uuid not null references public.app_users(id) on delete restrict,
  invite_token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  invite_id uuid not null references public.member_invites(id) on delete restrict,
  line_user_id text not null,
  requested_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.app_users(id) on delete restrict,
  approved_at timestamptz,
  rejected_by uuid references public.app_users(id) on delete restrict,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists membership_requests_pending_unique
  on public.membership_requests (workspace_id, line_user_id)
  where status = 'pending';

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  visibility_type text not null check (visibility_type in ('group', 'personal')),
  group_id uuid references public.groups(id) on delete set null,
  owner_user_id uuid references public.app_users(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped')),
  scheduled_date date not null,
  scheduled_time time,
  completed_at timestamptz,
  created_by uuid not null references public.app_users(id) on delete restrict,
  updated_by uuid not null references public.app_users(id) on delete restrict,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (visibility_type = 'group' and group_id is not null and owner_user_id is null)
    or
    (visibility_type = 'personal' and owner_user_id is not null and group_id is null)
  )
);

create index if not exists tasks_workspace_scheduled_date_idx
  on public.tasks (workspace_id, scheduled_date);

create index if not exists tasks_group_status_idx
  on public.tasks (group_id, status);

create index if not exists tasks_owner_status_idx
  on public.tasks (owner_user_id, status);

create table if not exists public.task_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  uploaded_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  visibility_type text not null check (visibility_type in ('group', 'personal')),
  group_id uuid references public.groups(id) on delete set null,
  owner_user_id uuid references public.app_users(id) on delete set null,
  title_template text not null,
  description_template text,
  default_priority text not null default 'medium' check (default_priority in ('high', 'medium', 'low')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  interval_value integer not null default 1 check (interval_value > 0),
  days_of_week smallint[],
  day_of_month smallint,
  time_of_day time,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id) on delete restrict,
  updated_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (visibility_type = 'group' and group_id is not null and owner_user_id is null)
    or
    (visibility_type = 'personal' and owner_user_id is not null and group_id is null)
  ),
  check (day_of_month is null or day_of_month between 1 and 31),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.generated_task_sources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  recurrence_rule_id uuid not null references public.recurrence_rules(id) on delete cascade,
  generated_for_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.task_activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  action_type text not null check (
    action_type in (
      'created',
      'updated',
      'deleted',
      'priority_changed',
      'status_changed',
      'started',
      'completed',
      'postponed_to_next_day',
      'photo_added',
      'photo_deleted',
      'photo_updated'
    )
  ),
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_logs_task_created_at_idx
  on public.task_activity_logs (task_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  device_label text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text not null check (platform in ('ios', 'android', 'web')),
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_members_updated_at on public.workspace_members;
create trigger set_workspace_members_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();

drop trigger if exists set_groups_updated_at on public.groups;
create trigger set_groups_updated_at
before update on public.groups
for each row execute function public.set_updated_at();

drop trigger if exists set_group_members_updated_at on public.group_members;
create trigger set_group_members_updated_at
before update on public.group_members
for each row execute function public.set_updated_at();

drop trigger if exists set_member_invites_updated_at on public.member_invites;
create trigger set_member_invites_updated_at
before update on public.member_invites
for each row execute function public.set_updated_at();

drop trigger if exists set_membership_requests_updated_at on public.membership_requests;
create trigger set_membership_requests_updated_at
before update on public.membership_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_task_photos_updated_at on public.task_photos;
create trigger set_task_photos_updated_at
before update on public.task_photos
for each row execute function public.set_updated_at();

drop trigger if exists set_recurrence_rules_updated_at on public.recurrence_rules;
create trigger set_recurrence_rules_updated_at
before update on public.recurrence_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_push_subscriptions_updated_at on public.push_subscriptions;
create trigger set_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

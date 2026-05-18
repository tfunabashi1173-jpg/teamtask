alter table public.workspaces
  add column if not exists floor_range_start smallint not null default 30;

alter table public.workspaces
  add column if not exists floor_range_end smallint not null default -3;

alter table public.tasks
  add column if not exists floor_level smallint;

alter table public.recurrence_rules
  add column if not exists floor_level smallint;

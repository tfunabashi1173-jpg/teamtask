alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority in ('urgent', 'high', 'medium', 'low'));

alter table public.recurrence_rules
  drop constraint if exists recurrence_rules_default_priority_check;

alter table public.recurrence_rules
  add constraint recurrence_rules_default_priority_check
  check (default_priority in ('urgent', 'high', 'medium', 'low'));

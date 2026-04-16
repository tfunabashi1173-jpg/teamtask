alter table public.task_activity_logs
  alter column task_id drop not null;

alter table public.task_activity_logs
  drop constraint if exists task_activity_logs_action_type_check;

alter table public.task_activity_logs
  add constraint task_activity_logs_action_type_check
  check (
    action_type in (
      'created',
      'updated',
      'deleted',
      'priority_changed',
      'status_changed',
      'started',
      'confirm_requested',
      'completed',
      'postponed_to_next_day',
      'photo_added',
      'photo_deleted',
      'photo_updated',
      'member_joined',
      'member_removed'
    )
  );

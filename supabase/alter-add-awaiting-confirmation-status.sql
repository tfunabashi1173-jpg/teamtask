alter table public.tasks
  drop constraint if exists tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check
  check (status in ('pending', 'in_progress', 'awaiting_confirmation', 'done', 'skipped'));

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
      'photo_updated'
    )
  );

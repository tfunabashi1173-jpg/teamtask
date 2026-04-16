-- Make task_id nullable to allow workspace-level events (member_joined, member_removed)
ALTER TABLE public.task_activity_logs
  ALTER COLUMN task_id DROP NOT NULL;

-- Expand action_type check constraint to include member events
ALTER TABLE public.task_activity_logs
  DROP CONSTRAINT IF EXISTS task_activity_logs_action_type_check;

ALTER TABLE public.task_activity_logs
  ADD CONSTRAINT task_activity_logs_action_type_check CHECK (
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

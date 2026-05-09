alter table public.task_photos
  add column if not exists thumbnail_storage_path text;

alter table public.task_reference_photos
  add column if not exists thumbnail_storage_path text;

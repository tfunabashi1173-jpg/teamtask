create table if not exists public.task_reference_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  uploaded_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_task_reference_photos_updated_at on public.task_reference_photos;
create trigger set_task_reference_photos_updated_at
before update on public.task_reference_photos
for each row execute function public.set_updated_at();

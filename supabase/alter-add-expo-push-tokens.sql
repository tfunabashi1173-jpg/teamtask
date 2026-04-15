create table if not exists public.expo_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  expo_push_token text not null unique,
  device_label text,
  platform text not null check (platform in ('ios', 'android')),
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_expo_push_tokens_updated_at on public.expo_push_tokens;
create trigger set_expo_push_tokens_updated_at
before update on public.expo_push_tokens
for each row execute function public.set_updated_at();

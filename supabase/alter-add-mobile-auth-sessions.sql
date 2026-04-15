create table if not exists public.mobile_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  oauth_state text not null unique,
  redirect_uri text not null,
  session_token text,
  line_user_id text,
  display_name text,
  picture_url text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'consumed', 'failed')),
  error_message text,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mobile_auth_sessions_oauth_state_idx
  on public.mobile_auth_sessions (oauth_state);

create index if not exists mobile_auth_sessions_status_expires_at_idx
  on public.mobile_auth_sessions (status, expires_at desc);

drop trigger if exists set_mobile_auth_sessions_updated_at on public.mobile_auth_sessions;
create trigger set_mobile_auth_sessions_updated_at
before update on public.mobile_auth_sessions
for each row execute function public.set_updated_at();

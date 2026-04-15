create table if not exists public.line_login_attempts (
  id uuid primary key default gen_random_uuid(),
  oauth_state text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'consumed', 'expired', 'failed')),
  session_payload jsonb,
  error_message text,
  completed_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_login_attempts_oauth_state_idx
  on public.line_login_attempts (oauth_state);

create index if not exists line_login_attempts_status_expires_at_idx
  on public.line_login_attempts (status, expires_at desc);

drop trigger if exists set_line_login_attempts_updated_at on public.line_login_attempts;
create trigger set_line_login_attempts_updated_at
before update on public.line_login_attempts
for each row execute function public.set_updated_at();

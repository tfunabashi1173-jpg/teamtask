with ranked_sources as (
  select
    g.id as source_id,
    g.task_id,
    g.recurrence_rule_id,
    g.generated_for_date,
    row_number() over (
      partition by g.recurrence_rule_id, g.generated_for_date
      order by
        case when t.deleted_at is null then 0 else 1 end,
        t.created_at,
        g.created_at,
        g.id
    ) as row_rank
  from public.generated_task_sources g
  join public.tasks t on t.id = g.task_id
),
duplicate_sources as (
  select source_id, task_id
  from ranked_sources
  where row_rank > 1
)
update public.tasks t
set
  deleted_at = coalesce(t.deleted_at, now()),
  updated_at = now()
from duplicate_sources d
where t.id = d.task_id
  and t.deleted_at is null;

with ranked_sources as (
  select
    g.id as source_id,
    row_number() over (
      partition by g.recurrence_rule_id, g.generated_for_date
      order by
        case when t.deleted_at is null then 0 else 1 end,
        t.created_at,
        g.created_at,
        g.id
    ) as row_rank
  from public.generated_task_sources g
  join public.tasks t on t.id = g.task_id
)
delete from public.generated_task_sources g
using ranked_sources r
where g.id = r.source_id
  and r.row_rank > 1;

create unique index if not exists generated_task_sources_rule_date_unique
  on public.generated_task_sources (recurrence_rule_id, generated_for_date);

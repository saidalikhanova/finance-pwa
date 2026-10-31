-- Общие данные семьи: таблица записей и правила доступа.
-- Вставьте целиком в Supabase → SQL Editor → New query → Run.

create table if not exists public.records (
  family      text        not null,
  store       text        not null,
  id          text        not null,
  data        jsonb,
  updated_at  timestamptz not null,
  deleted     boolean     not null default false,
  primary key (family, store, id)
);
create index if not exists records_family_updated on public.records (family, updated_at);

-- Семейный код приходит в заголовке x-family; строки видны только своей семье.
create or replace function public.family_code() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-family', '');
$$;

alter table public.records enable row level security;
drop policy if exists records_family on public.records;
create policy records_family on public.records
  for all
  using (length(public.family_code()) >= 24 and family = public.family_code())
  with check (length(public.family_code()) >= 24 and family = public.family_code());

-- Старая версия записи не затирает более новую (последняя правка побеждает).
create or replace function public.records_keep_newer() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists records_keep_newer on public.records;
create trigger records_keep_newer before update on public.records
  for each row execute function public.records_keep_newer();

grant select, insert, update on public.records to anon, authenticated;

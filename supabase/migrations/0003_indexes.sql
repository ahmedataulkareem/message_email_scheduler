-- With District 23 loaded (60k contacts, each carrying its full source row in
-- `raw`), anything that scanned the whole table hit Supabase's 8-second
-- statement timeout, including the daily birthday job. These make the hot
-- paths index lookups.

-- Birthday as month*100 + day (1105 = Nov 5). extract() on a date is
-- immutable, so it can be indexed; to_char() can't.
create index if not exists contacts_birthday_md_idx
  on contacts (tenant_id, ((extract(month from birthdate) * 100 + extract(day from birthdate))::int))
  where birthdate is not null;

create or replace function birthday_contacts(p_tenant_id uuid)
returns setof contacts
language plpgsql
stable
as $$
declare
  v_today date;
  v_mds int[];
begin
  select (now() at time zone timezone)::date into v_today from tenants where id = p_tenant_id;
  if v_today is null then
    raise exception 'unknown tenant %', p_tenant_id;
  end if;

  v_mds := array[(extract(month from v_today) * 100 + extract(day from v_today))::int];
  -- Feb 29 birthdays go out on Feb 28 in non-leap years.
  if v_mds[1] = 228 and extract(day from date_trunc('year', v_today) + interval '2 months' - interval '1 day') = 28 then
    v_mds := v_mds || 229;
  end if;

  return query
  select c.*
  from contacts c
  where c.tenant_id = p_tenant_id
    and c.birthdate is not null
    and (extract(month from c.birthdate) * 100 + extract(day from c.birthdate))::int = any (v_mds);
end;
$$;

-- Dashboard report reads messages by tenant and time.
create index if not exists messages_tenant_created_idx on messages (tenant_id, created_at);

-- Contacts page totals in one pass instead of five full-table counts.
create or replace function contact_stats(p_tenant_id uuid)
returns table (total int, with_email int, deliverable int, with_cell int, sms_opted_in int, with_birthdate int)
language sql
stable
as $$
  select
    count(*)::int,
    count(email)::int,
    count(*) filter (where email_status = 'deliverable')::int,
    count(cell_e164)::int,
    count(sms_consent_at)::int,
    count(birthdate)::int
  from contacts
  where tenant_id = p_tenant_id;
$$;

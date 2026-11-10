-- Fixes found while testing against the District 23 file.

-- 1. Contact identity. A unique index on cell_e164 rejected the 11,056
--    District 23 voters who share a household phone, and separate unique
--    indexes per field made upserts fail whenever two keys disagreed. One
--    external_key per contact (voter id, else email, else cell+name) replaces
--    all three; lib/contacts-import.ts externalKey() computes the same value.
drop index if exists contacts_tenant_voter_id_uq;
drop index if exists contacts_tenant_email_uq;
drop index if exists contacts_tenant_cell_uq;

alter table contacts add column if not exists external_key text;
update contacts set external_key = case
  when voter_id is not null then 'voter:' || voter_id
  when email is not null then 'email:' || email
  else 'cell:' || coalesce(cell_e164, '') || ':' || lower(coalesce(first_name, '')) || ':' || lower(coalesce(last_name, ''))
end
where external_key is null;
alter table contacts alter column external_key set not null;
create unique index if not exists contacts_tenant_external_key_uq on contacts (tenant_id, external_key);

-- 2. 'skipped' = not sent on purpose (test-mode allowlist), so it isn't
--    reported as a delivery failure.
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'undelivered', 'skipped'));

-- 3. Who has a birthday today, in the tenant's timezone. Shared by the
--    enqueue job and the dashboard count so they can't disagree.
create or replace function birthday_contacts(p_tenant_id uuid)
returns setof contacts
language sql
stable
as $$
  with t as (
    select (now() at time zone timezone)::date as today from tenants where id = p_tenant_id
  )
  select c.*
  from contacts c, t
  where c.tenant_id = p_tenant_id
    and c.birthdate is not null
    and (
      to_char(c.birthdate, 'MM-DD') = to_char(t.today, 'MM-DD')
      -- Feb 29 birthdays go out on Feb 28 in non-leap years.
      or (
        to_char(c.birthdate, 'MM-DD') = '02-29'
        and to_char(t.today, 'MM-DD') = '02-28'
        and extract(day from date_trunc('year', t.today) + interval '2 months' - interval '1 day') = 28
      )
    );
$$;

create or replace function birthdays_today(p_tenant_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from birthday_contacts(p_tenant_id);
$$;

create or replace function enqueue_birthdays(p_tenant_id uuid)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  if not exists (select 1 from tenants where id = p_tenant_id) then
    raise exception 'unknown tenant %', p_tenant_id;
  end if;

  with tpl as (
    select birthday_email_subject, birthday_email_body, birthday_sms_body from tenants where id = p_tenant_id
  ),
  b as (
    select * from birthday_contacts(p_tenant_id)
  ),
  ins_email as (
    insert into messages (tenant_id, contact_id, channel, to_addr, subject, body)
    select p_tenant_id, b.id, 'email', b.email, tpl.birthday_email_subject, tpl.birthday_email_body
    from b, tpl
    where b.email is not null
      and b.email_status <> 'undeliverable'
      and not exists (
        select 1 from suppressions s
        where s.tenant_id = p_tenant_id and s.channel = 'email' and s.value = b.email
      )
    on conflict do nothing
    returning 1
  ),
  ins_sms as (
    insert into messages (tenant_id, contact_id, channel, to_addr, body)
    select p_tenant_id, b.id, 'sms', b.cell_e164, tpl.birthday_sms_body
    from b, tpl
    where b.cell_e164 is not null
      and b.sms_consent_at is not null
      and not exists (
        select 1 from suppressions s
        where s.tenant_id = p_tenant_id and s.channel = 'sms' and s.value = b.cell_e164
      )
    on conflict do nothing
    returning 1
  )
  select (select count(*) from ins_email) + (select count(*) from ins_sms) into v_count;

  return v_count;
end;
$$;

-- 4. Broadcast email: one per address now that two contacts may share one.
create or replace function enqueue_campaign(p_campaign_id uuid)
returns int
language plpgsql
as $$
declare
  v_campaign campaigns%rowtype;
  v_count int;
begin
  select * into v_campaign from campaigns where id = p_campaign_id;
  if not found then
    raise exception 'unknown campaign %', p_campaign_id;
  end if;
  if v_campaign.status <> 'approved' then
    raise exception 'campaign % is not approved (status=%)', p_campaign_id, v_campaign.status;
  end if;

  if v_campaign.channel = 'email' then
    with targets as (
      select distinct on (c.email) c.id, c.email
      from contacts c
      where c.tenant_id = v_campaign.tenant_id
        and c.email is not null
        and c.email_status <> 'undeliverable'
        and (v_campaign.audience->>'party' is null or c.party = v_campaign.audience->>'party')
        and (v_campaign.audience->>'zip' is null or c.zip = v_campaign.audience->>'zip')
        and (v_campaign.audience->>'min_age' is null or c.age >= (v_campaign.audience->>'min_age')::int)
        and (v_campaign.audience->>'max_age' is null or c.age <= (v_campaign.audience->>'max_age')::int)
        and not exists (
          select 1 from suppressions s
          where s.tenant_id = v_campaign.tenant_id and s.channel = 'email' and s.value = c.email
        )
      order by c.email
    )
    insert into messages (tenant_id, campaign_id, contact_id, channel, to_addr, subject, body)
    select v_campaign.tenant_id, v_campaign.id, t.id, 'email', t.email, v_campaign.subject, v_campaign.body
    from targets t
    on conflict do nothing;
  else
    with targets as (
      select distinct on (c.cell_e164) c.id, c.cell_e164
      from contacts c
      where c.tenant_id = v_campaign.tenant_id
        and c.cell_e164 is not null
        and c.sms_consent_at is not null
        and (v_campaign.audience->>'party' is null or c.party = v_campaign.audience->>'party')
        and (v_campaign.audience->>'zip' is null or c.zip = v_campaign.audience->>'zip')
        and (v_campaign.audience->>'min_age' is null or c.age >= (v_campaign.audience->>'min_age')::int)
        and (v_campaign.audience->>'max_age' is null or c.age <= (v_campaign.audience->>'max_age')::int)
        and not exists (
          select 1 from suppressions s
          where s.tenant_id = v_campaign.tenant_id and s.channel = 'sms' and s.value = c.cell_e164
        )
      order by c.cell_e164
    )
    insert into messages (tenant_id, campaign_id, contact_id, channel, to_addr, body)
    select v_campaign.tenant_id, v_campaign.id, t.id, 'sms', t.cell_e164, v_campaign.body
    from targets t
    on conflict do nothing;
  end if;

  get diagnostics v_count = row_count;
  update campaigns set status = 'enqueued' where id = p_campaign_id;
  return v_count;
end;
$$;

-- 5. Claim: also recover messages left in 'sending' by a run that crashed
--    or timed out, instead of leaving them stuck forever.
create or replace function claim_messages(p_limit int default 300)
returns setof messages
language plpgsql
as $$
begin
  update messages
  set status = 'queued', updated_at = now()
  where status = 'sending' and updated_at < now() - interval '10 minutes';

  update messages m
  set status = 'failed', error = 'suppressed', updated_at = now()
  where m.status = 'queued'
    and exists (
      select 1 from suppressions s
      where s.tenant_id = m.tenant_id and s.channel = m.channel and s.value = m.to_addr
    );

  return query
  update messages m
  set status = 'sending', updated_at = now()
  from (
    select id from messages
    where status = 'queued' and next_attempt_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  ) claimed
  where m.id = claimed.id
  returning m.*;
end;
$$;

-- 6. Report counts by channel and status. Counted in SQL because a plain
--    select is capped at 1,000 rows and would undercount at real volume.
create or replace function message_stats(p_tenant_id uuid, p_since timestamptz)
returns table (channel text, status text, n int)
language sql
stable
as $$
  select channel, status, count(*)::int
  from messages
  where tenant_id = p_tenant_id and created_at >= p_since
  group by channel, status;
$$;

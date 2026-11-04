-- Email + SMS engine: tenants, contacts, suppressions, campaigns, messages.
-- Single-tenant pilot for now: the app reads DEFAULT_TENANT_ID from env and
-- the server always uses the service-role key, so RLS is not enabled yet.
-- ponytail: add RLS policies per tenant_id before a second customer goes live.

create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  from_email text not null,
  from_name text not null default '',
  email_footer text not null default '',
  sms_footer text not null default 'Reply STOP to opt out.',
  birthday_email_subject text not null default 'Happy Birthday, {{first_name}}!',
  birthday_email_body text not null default 'Wishing you a wonderful birthday, {{first_name}}!',
  birthday_sms_body text not null default 'Happy birthday, {{first_name}}! Hope you have a great day.',
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  role text not null check (role in ('admin', 'approver', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  voter_id text,
  first_name text,
  last_name text,
  email text,
  -- 'deliverable'/'undeliverable' usually come from a file's own verification
  -- column (e.g. District 23's Status field); 'unverified' is the default for
  -- anything else, and is still sendable (see enqueue_birthdays below).
  email_status text not null default 'unverified'
    check (email_status in ('deliverable', 'undeliverable', 'catch_all', 'unverified')),
  cell_e164 text,
  sms_consent_at timestamptz,
  birthdate date,
  zip text,
  city text,
  state text,
  county text,
  party text,
  gender text,
  age int,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_tenant_birthday_idx
  on contacts (tenant_id, extract(month from birthdate), extract(day from birthdate));
create index contacts_cell_idx on contacts (cell_e164);
create index contacts_email_idx on contacts (email);
-- Plain (non-partial) unique indexes: Postgres already lets unlimited rows
-- have a NULL voter_id/email/cell_e164 under a regular UNIQUE constraint, and
-- unlike a partial index, a plain one is a valid ON CONFLICT target for
-- Supabase's upsert() calls (used by the Excel upload feature).
create unique index contacts_tenant_voter_id_uq on contacts (tenant_id, voter_id);
create unique index contacts_tenant_email_uq on contacts (tenant_id, email);
create unique index contacts_tenant_cell_uq on contacts (tenant_id, cell_e164);

create table suppressions (
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  value text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, channel, value)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  subject text,
  body text not null,
  audience jsonb not null default '{}'::jsonb, -- {party?, zip?, min_age?, max_age?}
  send_at timestamptz not null default now(),
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'enqueued', 'done')),
  created_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  campaign_id uuid references campaigns (id) on delete cascade, -- null = birthday greeting
  contact_id uuid not null references contacts (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  to_addr text not null,
  subject text,
  body text not null, -- the raw {{first_name}} template; rendered at send time
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'undelivered')),
  provider_id text,
  error text,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One message per contact/channel/campaign/day, so a re-run cron can't double-send.
create unique index messages_dedupe_uq on messages (
  contact_id, channel, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'),
  ((created_at at time zone 'utc')::date)
);
create index messages_provider_idx on messages (provider_id);
create index messages_status_idx on messages (status, next_attempt_at);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants (id) on delete cascade,
  actor uuid references auth.users (id),
  action text not null,
  target text,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Enqueue today's birthday greetings for one tenant, plus any due campaigns
-- are enqueued separately via enqueue_campaign (called by the birthdays cron
-- once a campaign's send_at has passed).
-- ---------------------------------------------------------------------------
create or replace function enqueue_birthdays(p_tenant_id uuid)
returns int
language plpgsql
as $$
declare
  v_tz text;
  v_today date;
  v_year int;
  v_is_leap boolean;
  v_count int;
begin
  select timezone into v_tz from tenants where id = p_tenant_id;
  if v_tz is null then
    raise exception 'unknown tenant %', p_tenant_id;
  end if;

  v_today := (now() at time zone v_tz)::date;
  v_year := extract(year from v_today)::int;
  v_is_leap := (v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0));

  with tenant_tpl as (
    select birthday_email_subject, birthday_email_body, birthday_sms_body
    from tenants where id = p_tenant_id
  ),
  eligible as (
    select c.id, c.email, c.email_status, c.cell_e164, c.sms_consent_at
    from contacts c
    where c.tenant_id = p_tenant_id
      and c.birthdate is not null
      and (
        (extract(month from c.birthdate)::int = extract(month from v_today)::int
         and extract(day from c.birthdate)::int = extract(day from v_today)::int)
        or
        -- Feb 29 birthdays send on Feb 28 in non-leap years.
        (not v_is_leap
         and extract(month from v_today)::int = 2 and extract(day from v_today)::int = 28
         and extract(month from c.birthdate)::int = 2 and extract(day from c.birthdate)::int = 29)
      )
  ),
  ins_email as (
    insert into messages (tenant_id, contact_id, channel, to_addr, subject, body)
    select p_tenant_id, e.id, 'email', e.email, t.birthday_email_subject, t.birthday_email_body
    from eligible e, tenant_tpl t
    where e.email is not null
      and e.email_status <> 'undeliverable'
      and not exists (
        select 1 from suppressions s
        where s.tenant_id = p_tenant_id and s.channel = 'email' and s.value = e.email
      )
    on conflict do nothing
    returning 1
  ),
  ins_sms as (
    insert into messages (tenant_id, contact_id, channel, to_addr, body)
    select p_tenant_id, e.id, 'sms', e.cell_e164, t.birthday_sms_body
    from eligible e, tenant_tpl t
    where e.cell_e164 is not null
      and e.sms_consent_at is not null
      and not exists (
        select 1 from suppressions s
        where s.tenant_id = p_tenant_id and s.channel = 'sms' and s.value = e.cell_e164
      )
    on conflict do nothing
    returning 1
  )
  select (select count(*) from ins_email) + (select count(*) from ins_sms) into v_count;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue an approved campaign. One SMS per phone number even when a phone
-- is shared by a household (DISTINCT ON cell_e164); email has no such dedupe
-- need since contacts.email is already unique per tenant.
-- ---------------------------------------------------------------------------
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
      select c.id, c.email
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

-- ---------------------------------------------------------------------------
-- Claim up to p_limit queued messages for the send worker. Anything that
-- became suppressed after being queued (e.g. a STOP reply) is swept to
-- 'failed' first instead of being claimed or left stuck forever.
-- ---------------------------------------------------------------------------
create or replace function claim_messages(p_limit int default 300)
returns setof messages
language plpgsql
as $$
begin
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

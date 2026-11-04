-- One-time bulk import of the District 23 sample file (or any file with the
-- same 54-column layout) via `\copy`, which is far faster than row-by-row
-- inserts for ~70k rows. For an incremental upload with a *different* column
-- layout, use the in-app upload on /contacts instead (lib/contacts-import.ts).
--
-- Usage:
--   python scripts/xlsx_to_csv.py District23.xlsx data/district23.csv
--   psql "$DATABASE_URL" -v tenant_id='<uuid>' -f scripts/import.sql

create temporary table staging (
  sequence text,
  voter_id text,
  first_name text,
  middle_name text,
  last_name text,
  name_suffix text,
  address_line text,
  extra_address_line text,
  city text,
  state text,
  zip text,
  zip_plus4 text,
  landline text,
  cell text,
  exist_on_whatsapp text,
  email text,
  email_status text,
  gender text,
  age text,
  birthdate text,
  party text,
  ethnic_description text,
  ethnic_group1 text,
  religion text,
  language text,
  marital_status text,
  us_congressional_district text,
  state_senate_district text,
  state_house_district text,
  county text,
  occupation text,
  occupation_group text,
  occupation_industry text,
  donates_environment text,
  donates_charity text,
  donates_animal_welfare text,
  donates_arts text,
  donates_childrens text,
  donates_conservative text,
  donates_intl_aid text,
  donates_liberal text,
  donates_healthcare text,
  donates_veterans text,
  fec_avg_donation text,
  fec_last_donation text,
  donates_wildlife text,
  general_2022 text,
  primary_2022 text,
  general_2020 text,
  primary_2020 text,
  general_2018 text,
  primary_2018 text,
  general_2016 text,
  primary_2016 text
);

\copy staging from 'data/district23.csv' with (format csv, header true)

insert into contacts (
  tenant_id, voter_id, first_name, last_name, email, email_status, cell_e164,
  birthdate, zip, city, state, county, party, gender, age, raw
)
select
  :'tenant_id'::uuid,
  nullif(voter_id, ''),
  nullif(first_name, ''),
  nullif(last_name, ''),
  case when lower(trim(email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(trim(email)) else null end,
  case lower(trim(coalesce(email_status, '')))
    when 'deliverable' then 'deliverable'
    when 'undeliverable' then 'undeliverable'
    when 'catch all' then 'catch_all'
    else 'unverified'
  end,
  case when regexp_replace(coalesce(cell, ''), '\D', '', 'g') ~ '^\d{10}$'
    then '+1' || regexp_replace(cell, '\D', '', 'g')
    else null end,
  -- "1/1/9999" marks a year-only birth year (see Column_Description.xlsx); drop it.
  case when birthdate ~ '^\d{4}-\d{2}-\d{2}' and birthdate not like '%9999%'
    then birthdate::date else null end,
  nullif(zip, ''),
  nullif(city, ''),
  nullif(state, ''),
  nullif(county, ''),
  nullif(party, ''),
  nullif(gender, ''),
  nullif(age, '')::int,
  to_jsonb(staging.*)
from staging
where (lower(trim(coalesce(email, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
   or (regexp_replace(coalesce(cell, ''), '\D', '', 'g') ~ '^\d{10}$')
on conflict do nothing;

select count(*) as imported from contacts where tenant_id = :'tenant_id'::uuid;

# Constituent messaging — email + SMS engine

Daily birthday greetings and approved broadcasts, by email and SMS, with
delivery tracking and opt-out handling. Built per
`docs/Constituent-Engagement-Bot-Feasibility-Report.pdf` and the plan in this
session's history; social ads, WhatsApp and AI drafting are deliberately out
of scope for this first build (see "Later" in the plan).

## Stack

Next.js (TypeScript, App Router) on Vercel · Supabase (Postgres + Auth) ·
Amazon SES · Twilio · a Postgres-table queue (no Redis/SQS).

## Setup

1. `npm install`
2. Create a Supabase project, run `supabase/migrations/0001_init.sql`
   against it, and insert one `tenants` row for your pilot customer.
3. Copy `.env.example` to `.env.local` and fill it in — `DEFAULT_TENANT_ID`
   is that tenant's id. Keep `SEND_ALLOWLIST` set everywhere except
   production so a bug can't message real people.
4. `npm run dev`. Sign in at `/login` with a Supabase Auth user's email —
   the first login creates a `staff` membership automatically (see
   `lib/auth.ts`).
5. `npm test` runs the unit tests (`lib/send.test.ts`,
   `lib/contacts-import.test.ts`).

## Loading contacts

- **Bulk seed (District 23 or similar 54-column file):**
  `python scripts/xlsx_to_csv.py District23.xlsx data/district23.csv`, then
  `psql "$DATABASE_URL" -v tenant_id='<uuid>' -f scripts/import.sql`.
- **Any other file, in the app:** `/contacts` → Upload. Columns are matched
  by name (see `lib/contacts-import.ts`'s alias table), so it doesn't need
  to match District 23's exact layout — just a first name, a last name, and
  an email or cell phone column.

## Deploying

`vercel.json` defines the two cron jobs (`/api/cron/birthdays` daily,
`/api/cron/send` every minute — the latter needs Vercel Pro). Point Twilio's
Messaging Service status callback and SES's event destination (via SNS) at
`/api/webhooks/twilio` and `/api/webhooks/ses`. The `/join` page is the
public SMS opt-in form; its URL is what you register with Twilio's 10DLC
campaign.

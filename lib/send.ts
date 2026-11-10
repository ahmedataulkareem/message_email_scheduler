import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import twilioLib from "twilio";
import crypto from "node:crypto";

export type Channel = "email" | "sms";

export interface TemplateContact {
  first_name: string | null;
}

export interface Tenant {
  id: string;
  timezone: string;
  from_email: string;
  from_name: string;
  email_footer: string;
  sms_footer: string;
}

/** Fills {{first_name}} only — used for subjects, which don't carry a footer. */
export function fillName(template: string, contact: TemplateContact): string {
  const name = contact.first_name?.trim() || "friend";
  return template.replace(/\{\{\s*first_name\s*\}\}/g, name);
}

/** Fills {{first_name}} and appends the channel's footer (e.g. a "Paid for by" line). */
export function render(template: string, contact: TemplateContact, tenant: Tenant, channel: Channel): string {
  const filled = fillName(template, contact);
  const footer = channel === "email" ? tenant.email_footer : tenant.sms_footer;
  return footer ? `${filled}\n\n${footer}` : filled;
}

/** SMS only sends 8am-9pm in the tenant's own timezone. */
export function inQuietHours(now: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(now)
  );
  const h = hour === 24 ? 0 : hour; // some ICU builds print midnight as "24"
  return h < 8 || h >= 21;
}

/** Next allowed send time if currently in quiet hours, else `now` unchanged. */
export function nextSendableTime(now: Date, timezone: string): Date {
  if (!inQuietHours(now, timezone)) return now;
  // ponytail: a 15-min stepping loop beats hand-computing tz offsets/DST,
  // and this runs once per queued SMS, not in a hot path.
  const probe = new Date(now);
  for (let i = 0; i < 4 * 36; i++) {
    probe.setMinutes(probe.getMinutes() + 15);
    if (!inQuietHours(probe, timezone)) return probe;
  }
  return probe;
}

function unsubSecret(): string {
  const s = process.env.UNSUB_SECRET;
  if (!s) throw new Error("UNSUB_SECRET not set");
  return s;
}

export function unsubToken(contactId: string, channel: Channel): string {
  const h = crypto.createHmac("sha256", unsubSecret()).update(`${contactId}:${channel}`).digest("hex");
  return `${contactId}.${channel}.${h}`;
}

export function verifyUnsubToken(token: string): { contactId: string; channel: Channel } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [contactId, channel, hash] = parts;
  if (channel !== "email" && channel !== "sms") return null;
  const expected = crypto.createHmac("sha256", unsubSecret()).update(`${contactId}:${channel}`).digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { contactId, channel };
}

function allowlist(): Set<string> | null {
  const raw = process.env.SEND_ALLOWLIST;
  if (!raw) return null;
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** Guards against an accidental blast outside dev/staging: see SEND_ALLOWLIST in .env.example. */
export function blockedByAllowlist(toAddr: string): boolean {
  const list = allowlist();
  if (!list) return false;
  return !list.has(toAddr.trim().toLowerCase());
}

let sesClient: SESv2Client | null = null;
function ses(): SESv2Client {
  if (!sesClient) sesClient = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });
  return sesClient;
}

export async function sendEmailProvider(args: {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ providerId: string }> {
  const res = await ses().send(
    new SendEmailCommand({
      FromEmailAddress: `${args.fromName} <${args.from}>`,
      Destination: { ToAddresses: [args.to] },
      Content: {
        Simple: {
          Subject: { Data: args.subject },
          Body: { Text: { Data: args.text } },
          Headers: [
            { Name: "List-Unsubscribe", Value: `<${args.unsubscribeUrl}>` },
            { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
          ],
        },
      },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
    })
  );
  return { providerId: res.MessageId || "" };
}

let twilioClient: ReturnType<typeof twilioLib> | null = null;
function twilio() {
  if (!twilioClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set");
    twilioClient = twilioLib(sid, token);
  }
  return twilioClient;
}

export async function sendSmsProvider(args: { to: string; body: string }): Promise<{ providerId: string }> {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  // A Messaging Service bundles senders, auto opt-out handling, etc. — the
  // right setup once 10DLC is approved. ponytail: Twilio trial accounts can't
  // create one without upgrading (adding billing), so for a free pilot/test
  // run, send straight from one trial number instead via TWILIO_FROM_NUMBER.
  if (!messagingServiceSid && !fromNumber) {
    throw new Error("Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }
  const appUrl = process.env.APP_URL ?? "";
  const msg = await twilio().messages.create({
    to: args.to,
    body: args.body,
    ...(messagingServiceSid ? { messagingServiceSid } : { from: fromNumber }),
    // Twilio can't call back to localhost, so delivery receipts only work deployed.
    ...(appUrl.startsWith("https://") ? { statusCallback: `${appUrl}/api/webhooks/twilio` } : {}),
  });
  return { providerId: msg.sid };
}

/**
 * A 4xx from Twilio or SES (bad number, unverified address, trial-account
 * restriction…) won't succeed on retry, so the message fails at once instead
 * of sitting in the queue for three attempts. 429 is throttling: retry it.
 */
export function isPermanentError(err: unknown): boolean {
  const e = err as { status?: number; $metadata?: { httpStatusCode?: number } } | null;
  const code = e?.status ?? e?.$metadata?.httpStatusCode;
  return typeof code === "number" && code >= 400 && code < 500 && code !== 429;
}

/**
 * Turns a wall-clock time typed into a <input type="datetime-local"> (no
 * timezone, e.g. "2026-11-12T09:30") into the UTC instant it means in the
 * tenant's timezone. Without this the server's own timezone was used.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const [date, time = "00:00"] = local.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(guess)
      .map((x) => [x.type, x.value])
  );
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
  return new Date(guess - offset);
}

/** Exponential backoff: 2^attempts minutes, gives up after 3 tries. */
export function nextRetry(attempts: number): { nextAttemptAt: Date; failed: boolean } {
  if (attempts >= 3) return { nextAttemptAt: new Date(), failed: true };
  const minutes = Math.pow(2, attempts);
  return { nextAttemptAt: new Date(Date.now() + minutes * 60_000), failed: false };
}

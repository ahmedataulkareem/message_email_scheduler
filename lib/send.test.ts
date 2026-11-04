import { test } from "node:test";
import assert from "node:assert/strict";
import {
  render,
  fillName,
  inQuietHours,
  unsubToken,
  verifyUnsubToken,
  blockedByAllowlist,
  nextRetry,
  type Tenant,
} from "./send";

process.env.UNSUB_SECRET = "test-secret";

const tenant: Tenant = {
  id: "t1",
  timezone: "America/New_York",
  from_email: "hello@example.com",
  from_name: "Team",
  email_footer: "Paid for by Example Committee.",
  sms_footer: "Reply STOP to opt out.",
};

test("render fills first_name and appends the channel footer", () => {
  const out = render("Happy birthday, {{first_name}}!", { first_name: "Pat" }, tenant, "email");
  assert.equal(out, "Happy birthday, Pat!\n\nPaid for by Example Committee.");
});

test("render falls back to 'friend' when first_name is missing", () => {
  const out = render("Hi {{first_name}}", { first_name: null }, tenant, "sms");
  assert.ok(out.startsWith("Hi friend"));
  assert.ok(out.includes("Reply STOP to opt out."));
});

test("fillName has no footer, for subjects", () => {
  assert.equal(fillName("Happy Birthday, {{first_name}}!", { first_name: "Pat" }), "Happy Birthday, Pat!");
});

test("inQuietHours is false at 10am and true at 10pm Eastern", () => {
  // 2026-06-15 10:00 ET = 14:00 UTC
  assert.equal(inQuietHours(new Date("2026-06-15T14:00:00Z"), "America/New_York"), false);
  // 2026-06-15 22:00 ET = 02:00 UTC the next day
  assert.equal(inQuietHours(new Date("2026-06-16T02:00:00Z"), "America/New_York"), true);
});

test("unsub token round-trips and rejects tampering", () => {
  const token = unsubToken("contact-123", "email");
  assert.deepEqual(verifyUnsubToken(token), { contactId: "contact-123", channel: "email" });
  assert.equal(verifyUnsubToken(token + "x"), null);
  assert.equal(verifyUnsubToken("not-a-token"), null);
});

test("allowlist blocks addresses not on the list, case-insensitively", () => {
  process.env.SEND_ALLOWLIST = "a@example.com, +15551234567";
  assert.equal(blockedByAllowlist("A@Example.com"), false);
  assert.equal(blockedByAllowlist("stranger@example.com"), true);
  delete process.env.SEND_ALLOWLIST;
});

test("blockedByAllowlist allows everything when unset (production)", () => {
  delete process.env.SEND_ALLOWLIST;
  assert.equal(blockedByAllowlist("anyone@example.com"), false);
});

test("nextRetry backs off then gives up after 3 attempts", () => {
  assert.equal(nextRetry(0).failed, false);
  assert.equal(nextRetry(2).failed, false);
  assert.equal(nextRetry(3).failed, true);
});

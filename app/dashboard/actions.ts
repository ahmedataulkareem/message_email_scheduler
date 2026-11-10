"use server";

import { redirect } from "next/navigation";
import { requireApprover } from "@/lib/auth";
import { enqueueBirthdays, enqueueDueCampaigns, sendQueued } from "@/lib/jobs";

function done(message: string, errors: string[]): never {
  const text = errors.length ? `${message} Errors: ${errors.join("; ")}` : message;
  redirect(`/dashboard?ran=${encodeURIComponent(text)}`);
}

export async function runBirthdaysNow() {
  await requireApprover();
  const r = await enqueueBirthdays();
  done(`Queued ${r.queued} birthday message(s).`, r.errors);
}

export async function sendNow() {
  await requireApprover();
  const c = await enqueueDueCampaigns();
  const s = await sendQueued();
  done(
    `Queued ${c.queued} from ${c.campaigns} campaign(s). Sent ${s.sent}, failed ${s.failed}, ` +
      `skipped ${s.skipped} (test mode), deferred ${s.deferred} (SMS quiet hours).`,
    [...c.errors, ...s.errors]
  );
}

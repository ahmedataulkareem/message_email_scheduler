"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireMembership, requireApprover } from "@/lib/auth";

export async function createCampaign(formData: FormData) {
  const { tenantId, userId } = await requireMembership();
  const db = supabaseAdmin();

  const channel = String(formData.get("channel"));
  const subject = String(formData.get("subject") || "").trim() || null;
  const body = String(formData.get("body") || "").trim();
  const party = String(formData.get("party") || "").trim() || null;
  const zip = String(formData.get("zip") || "").trim() || null;
  const minAge = String(formData.get("min_age") || "").trim();
  const maxAge = String(formData.get("max_age") || "").trim();
  const sendAt = String(formData.get("send_at") || "");

  if (!body) redirect("/campaigns?error=Message body is required");

  const audience: Record<string, string> = {};
  if (party) audience.party = party;
  if (zip) audience.zip = zip;
  if (minAge) audience.min_age = minAge;
  if (maxAge) audience.max_age = maxAge;

  const { error } = await db.from("campaigns").insert({
    tenant_id: tenantId,
    channel,
    subject: channel === "email" ? subject : null,
    body,
    audience,
    send_at: sendAt ? new Date(sendAt).toISOString() : new Date().toISOString(),
    status: "pending",
    created_by: userId,
  });

  if (error) redirect(`/campaigns?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function approveCampaign(campaignId: string) {
  const { tenantId, userId } = await requireApprover();
  const db = supabaseAdmin();

  await db
    .from("campaigns")
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);

  await db.from("audit_log").insert({ tenant_id: tenantId, actor: userId, action: "campaign.approve", target: campaignId });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

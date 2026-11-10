import { NextResponse, type NextRequest } from "next/server";
import { enqueueDueCampaigns, sendQueued } from "@/lib/jobs";

export const maxDuration = 60;

// Every minute (vercel.json). Campaigns are enqueued here, not in the daily
// birthday job, so an approved broadcast goes out within a minute instead of
// waiting for the next morning.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const campaigns = await enqueueDueCampaigns();
  const send = await sendQueued();
  return NextResponse.json({ campaigns, send });
}

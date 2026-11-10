import { NextResponse, type NextRequest } from "next/server";
import { enqueueBirthdays } from "@/lib/jobs";

// Daily (vercel.json: 14:00 UTC, about 10am America/New_York; drifts an hour
// with DST, fine for a daily greeting).
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await enqueueBirthdays());
}

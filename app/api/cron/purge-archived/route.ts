import { NextResponse } from "next/server";
import { purgeExpiredArchivedNotes } from "@/lib/notes";

/**
 * Nightly hard-purge of Archived notes older than retention.
 * Secured with `CRON_SECRET` (Vercel Cron Authorization: Bearer …).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await purgeExpiredArchivedNotes();
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("purge archived failed", error);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import {
  compactNoteDoc,
  listNoteDocCompactionCandidates,
} from "@/lib/crdt/note-doc-store";

/**
 * Notes compacted per run. The update log is append-only, so without this the
 * tail grows without bound; the cap keeps one invocation inside the function
 * timeout and the next run picks up whatever was left.
 */
export const COMPACT_BATCH_LIMIT = 100;

/**
 * Nightly fold of each note's CRDT update tail back into its snapshot.
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
    const candidates = await listNoteDocCompactionCandidates(
      COMPACT_BATCH_LIMIT,
    );

    let compacted = 0;
    let removedUpdates = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;

    for (const candidate of candidates) {
      try {
        const result = await compactNoteDoc(candidate.noteId);
        if (!result) continue;
        compacted += 1;
        removedUpdates += result.removedUpdates;
        bytesBefore += result.bytesBefore;
        bytesAfter += result.bytesAfter;
      } catch (error) {
        // One bad note must not stop the sweep.
        console.error("compact note doc failed", {
          noteId: candidate.noteId,
          error,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: candidates.length,
      compacted,
      removedUpdates,
      bytesBefore,
      bytesAfter,
      /** More notes were over threshold than this run could take. */
      truncated: candidates.length === COMPACT_BATCH_LIMIT,
    });
  } catch (error) {
    console.error("compact note docs failed", error);
    return NextResponse.json({ error: "Compaction failed" }, { status: 500 });
  }
}

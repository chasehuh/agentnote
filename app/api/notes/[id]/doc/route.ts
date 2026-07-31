import { NextResponse } from "next/server";
import { bytesToBase64 } from "@/lib/crdt/note-doc";
import { getNoteDocState } from "@/lib/crdt/note-doc-store";
import { isValidNoteId } from "@/lib/note-id";
import { resolveCanonicalNoteId } from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

type Params = { params: Promise<{ id: string }> };

function notFoundResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * Full CRDT state for a note, seeding from `notes.body` on first open.
 * The client applies this with a `"remote"` origin and keeps `seq` as its
 * pull cursor.
 */
export async function GET(_request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return notFoundResponse();

  try {
    const canonicalId = await resolveCanonicalNoteId(authResult.userId, id);
    if (!canonicalId) return notFoundResponse();

    const state = await getNoteDocState(authResult.userId, canonicalId);
    if (!state) return notFoundResponse();

    return NextResponse.json({
      note_id: canonicalId,
      update: bytesToBase64(state.update),
      seq: state.seq,
      created: state.created,
    });
  } catch (error) {
    console.error("get note doc failed", error);
    return NextResponse.json(
      { error: "Failed to get note doc" },
      { status: 500 },
    );
  }
}

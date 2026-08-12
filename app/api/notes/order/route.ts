import { NextResponse } from "next/server";
import { parseReorderIds } from "@/lib/note-order";
import { reorderNotes } from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

/**
 * Persist the manual sidebar order of one sibling group, top row first.
 *
 * Static segment, so it never reaches `/api/notes/[id]` — and `order` is not a
 * valid note id anyway. Returns the rows it wrote so the client can replace its
 * optimistic ranks with the authoritative ones.
 */
export async function PUT(request: Request) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  try {
    let payload: { ids?: unknown };
    try {
      payload = (await request.json()) as { ids?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const ids = parseReorderIds(payload.ids);
    if (!ids) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    const notes = await reorderNotes(authResult.userId, ids);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("reorder notes failed", error);
    return NextResponse.json(
      { error: "Failed to reorder notes" },
      { status: 500 },
    );
  }
}

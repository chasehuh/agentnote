import { NextResponse } from "next/server";
import { isValidNoteId } from "@/lib/note-id";
import {
  createNote,
  listArchivedNotes,
  listNotes,
  resolveParentNoteId,
} from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

export async function GET(request: Request) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  try {
    const archived =
      new URL(request.url).searchParams.get("archived") === "1";
    const notes = archived
      ? await listArchivedNotes(authResult.userId)
      : await listNotes(authResult.userId);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("list notes failed", error);
    return NextResponse.json({ error: "Failed to list notes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  try {
    let title = "";
    let body = "";
    let rawParentId: unknown;
    try {
      const payload = (await request.json()) as {
        title?: string;
        body?: string;
        parent_id?: unknown;
      };
      title = payload.title ?? "";
      body = payload.body ?? "";
      rawParentId = payload.parent_id;
    } catch {
      // empty note is fine
    }

    // Absent / null / "" = root note. Anything else must resolve to a live note
    // this user owns — a parent is a user-supplied FK into `notes`, so trusting
    // the string would let a crafted POST nest under another tenant's row.
    let parentId: string | null = null;
    if (rawParentId != null && rawParentId !== "") {
      if (typeof rawParentId !== "string" || !isValidNoteId(rawParentId)) {
        return NextResponse.json(
          { error: "Invalid parent_id" },
          { status: 400 },
        );
      }
      parentId = await resolveParentNoteId(authResult.userId, rawParentId);
      if (!parentId) {
        return NextResponse.json(
          { error: "Invalid parent_id" },
          { status: 400 },
        );
      }
    }

    const note = await createNote(authResult.userId, { title, body, parentId });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("create note failed", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

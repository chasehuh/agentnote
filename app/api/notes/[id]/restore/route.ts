import { NextResponse } from "next/server";
import { isValidNoteId } from "@/lib/note-id";
import { restoreNote } from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const note = await restoreNote(authResult.userId, id);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("restore note failed", error);
    return NextResponse.json(
      { error: "Failed to restore note" },
      { status: 500 },
    );
  }
}

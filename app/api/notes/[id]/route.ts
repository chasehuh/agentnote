import { NextResponse } from "next/server";
import { isValidNoteId } from "@/lib/note-id";
import {
  archiveNote,
  getNote,
  permanentlyDeleteNote,
  updateNote,
} from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

type Params = { params: Promise<{ id: string }> };

function invalidIdResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return invalidIdResponse();
  try {
    const note = await getNote(authResult.userId, id);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("get note failed", error);
    return NextResponse.json({ error: "Failed to get note" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return invalidIdResponse();
  try {
    const payload = (await request.json()) as {
      title?: string;
      body?: string;
    };
    const note = await updateNote(authResult.userId, id, {
      title: payload.title ?? "",
      body: payload.body ?? "",
    });
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("update note failed", error);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return invalidIdResponse();

  const permanent =
    new URL(request.url).searchParams.get("permanent") === "1";

  try {
    if (permanent) {
      const ok = await permanentlyDeleteNote(authResult.userId, id);
      if (!ok) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, permanent: true });
    }

    const note = await archiveNote(authResult.userId, id);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, note });
  } catch (error) {
    console.error("delete note failed", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}

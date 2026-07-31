import { NextResponse } from "next/server";
import { isCrdtManagedNote } from "@/lib/crdt/note-doc-store";
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
      expected_updated_at?: string;
    };

    const expectedUpdatedAt =
      typeof payload.expected_updated_at === "string"
        ? payload.expected_updated_at.trim()
        : "";
    // Fail closed: old clients without a concurrency token must not LWW-write.
    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { error: "expected_updated_at is required" },
        { status: 400 },
      );
    }

    // A CRDT-backed body is owned by the Yjs doc. A whole-document PUT would
    // LWW-clobber the projection, so refuse it with a machine-readable reason.
    if (
      typeof payload.body === "string" &&
      (await isCrdtManagedNote(authResult.userId, id))
    ) {
      const note = await getNote(authResult.userId, id);
      if (!note) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Conflict", reason: "crdt_managed_body", note },
        { status: 409 },
      );
    }

    const result = await updateNote(authResult.userId, id, {
      title: payload.title ?? "",
      body: payload.body ?? "",
      expectedUpdatedAt,
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.status === "conflict") {
      return NextResponse.json(
        { error: "Conflict", note: result.note },
        { status: 409 },
      );
    }
    return NextResponse.json({ note: result.note });
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

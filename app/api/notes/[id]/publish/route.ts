import { NextResponse } from "next/server";
import { resolvePublisherHandle } from "@/lib/clerk-handle";
import { isValidNoteId } from "@/lib/note-id";
import {
  publishNote,
  rotatePublicId,
  unpublishNote,
} from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

type Params = { params: Promise<{ id: string }> };

function invalidIdResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Publish (or keep published). Body `{ "rotate": true }` resets the public link. */
export async function POST(request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return invalidIdResponse();

  let rotate = false;
  try {
    const payload = (await request.json()) as { rotate?: boolean };
    rotate = Boolean(payload?.rotate);
  } catch {
    // empty body = plain publish
  }

  const authorHandle = await resolvePublisherHandle();

  try {
    const note = rotate
      ? await rotatePublicId(authResult.userId, id, authorHandle)
      : await publishNote(authResult.userId, id, authorHandle);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("publish note failed", error);
    return NextResponse.json(
      { error: "Failed to publish note" },
      { status: 500 },
    );
  }
}

/** Unpublish — hard-revokes the public link. */
export async function DELETE(_request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return invalidIdResponse();

  try {
    const note = await unpublishNote(authResult.userId, id);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("unpublish note failed", error);
    return NextResponse.json(
      { error: "Failed to unpublish note" },
      { status: 500 },
    );
  }
}

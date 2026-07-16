import { NextResponse } from "next/server";
import { createNote, listArchivedNotes, listNotes } from "@/lib/notes";
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
    try {
      const payload = (await request.json()) as {
        title?: string;
        body?: string;
      };
      title = payload.title ?? "";
      body = payload.body ?? "";
    } catch {
      // empty note is fine
    }
    const note = await createNote(authResult.userId, { title, body });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("create note failed", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createNote, listNotes } from "@/lib/notes";

export async function GET() {
  try {
    const notes = await listNotes();
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("list notes failed", error);
    return NextResponse.json({ error: "Failed to list notes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    const note = await createNote({ title, body });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("create note failed", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

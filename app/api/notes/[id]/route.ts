import { NextResponse } from "next/server";
import { deleteNote, getNote, updateNote } from "@/lib/notes";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const note = await getNote(id);
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
  const { id } = await params;
  try {
    const payload = (await request.json()) as {
      title?: string;
      body?: string;
    };
    const note = await updateNote(id, {
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

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const ok = await deleteNote(id);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("delete note failed", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}

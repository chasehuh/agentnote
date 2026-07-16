import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicNoteView } from "@/components/public-note-view";
import { isValidPublicId } from "@/lib/public-id";
import { getPublicNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

function previewTitle(title: string, body: string) {
  const fromTitle = title.trim();
  if (fromTitle) return fromTitle;
  const firstLine = body.split("\n").find((line) => line.trim());
  return firstLine?.trim() || "Untitled";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  if (!isValidPublicId(token)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const note = await getPublicNote(token);
  if (!note) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  return {
    title: previewTitle(note.title, note.body),
    robots: { index: false, follow: false },
  };
}

export default async function PublicNotePage({ params }: Props) {
  const { token } = await params;
  if (!isValidPublicId(token)) notFound();

  const note = await getPublicNote(token);
  if (!note) notFound();

  return (
    <PublicNoteView
      title={previewTitle(note.title, note.body)}
      body={note.body}
    />
  );
}

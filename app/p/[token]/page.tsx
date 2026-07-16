import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicNoteView } from "@/components/public-note-view";
import { getPublicNote } from "@/lib/notes";
import { isValidPublicId, publicNotePath } from "@/lib/public-id";
import { previewPublicTitle } from "@/lib/public-note-meta";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  if (!isValidPublicId(token)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const note = await getPublicNote(token);
  if (!note) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const title = previewPublicTitle(note.title, note.body);
  return {
    title: note.author_handle ? `${title} · @${note.author_handle}` : title,
    robots: { index: false, follow: false },
  };
}

/** Legacy/share-token-only URL → canonical `/p/{handle}/{token}` when possible. */
export default async function PublicNoteTokenPage({ params }: Props) {
  const { token } = await params;
  if (!isValidPublicId(token)) notFound();

  const note = await getPublicNote(token);
  if (!note) notFound();

  if (note.author_handle) {
    permanentRedirect(publicNotePath(note.id, note.author_handle));
  }

  // Prefer canonical Meet-style note id over a legacy opaque token.
  if (token !== note.id) {
    permanentRedirect(publicNotePath(note.id, null));
  }

  return (
    <PublicNoteView
      title={previewPublicTitle(note.title, note.body)}
      body={note.body}
      authorHandle={null}
    />
  );
}

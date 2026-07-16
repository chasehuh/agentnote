import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicNoteView } from "@/components/public-note-view";
import { isValidAuthorHandle, normalizeAuthorHandle } from "@/lib/author-handle";
import { getPublicNote } from "@/lib/notes";
import { isValidPublicId, publicNotePath } from "@/lib/public-id";
import { previewPublicTitle } from "@/lib/public-note-meta";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle: rawHandle, token } = await params;
  const handle = normalizeAuthorHandle(rawHandle);
  if (!handle || !isValidPublicId(token)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const note = await getPublicNote(token);
  if (!note) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const title = previewPublicTitle(note.title, note.body);
  const by = note.author_handle ?? handle;
  return {
    title: `${title} · @${by}`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicNoteHandlePage({ params }: Props) {
  const { handle: rawHandle, token } = await params;
  const handle = normalizeAuthorHandle(rawHandle);
  if (!handle || !isValidAuthorHandle(handle) || !isValidPublicId(token)) {
    notFound();
  }

  const note = await getPublicNote(token);
  if (!note) notFound();

  // Note id is authoritative; wrong/stale handle → canonical URL.
  if (note.author_handle && note.author_handle !== handle) {
    permanentRedirect(publicNotePath(note.id, note.author_handle));
  }

  // Prefer Meet-style note id in the path over a legacy opaque token.
  if (token !== note.id) {
    permanentRedirect(publicNotePath(note.id, note.author_handle ?? handle));
  }

  return (
    <PublicNoteView
      title={previewPublicTitle(note.title, note.body)}
      body={note.body}
      authorHandle={note.author_handle ?? handle}
    />
  );
}

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicNoteView } from "@/components/public-note-view";
import { getPublicNote } from "@/lib/notes";
import { publicNotePath } from "@/lib/public-id";
import { previewPublicTitle } from "@/lib/public-note-meta";
import { parsePublicRouteParts } from "@/lib/public-route";

type Props = { params: Promise<{ parts: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { parts } = await params;
  const route = parsePublicRouteParts(parts);
  if (!route) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const note = await getPublicNote(route.token);
  if (!note) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const title = previewPublicTitle(note.title, note.body);
  const by =
    note.author_handle ?? (route.kind === "handle" ? route.handle : null);
  return {
    title: by ? `${title} · @${by}` : title,
    robots: { index: false, follow: false },
  };
}

/**
 * Single catch-all for public notes.
 *
 * Next.js cannot host both `/p/[token]` and `/p/[handle]/[token]` — they
 * collide as the same dynamic path with different param names and break
 * `next start`. Prefer canonical `/p/{handle}/{id}`; keep one-segment
 * URLs as a legacy redirect/render path.
 */
export default async function PublicNotePage({ params }: Props) {
  const { parts } = await params;
  const route = parsePublicRouteParts(parts);
  if (!route) notFound();

  const note = await getPublicNote(route.token);
  if (!note) notFound();

  if (route.kind === "handle") {
    // Note id is authoritative; wrong/stale handle → canonical URL.
    if (note.author_handle && note.author_handle !== route.handle) {
      permanentRedirect(publicNotePath(note.id, note.author_handle));
    }

    // Prefer Meet-style note id in the path over a legacy opaque token.
    if (route.token !== note.id) {
      permanentRedirect(
        publicNotePath(note.id, note.author_handle ?? route.handle),
      );
    }

    return (
      <PublicNoteView
        title={previewPublicTitle(note.title, note.body)}
        body={note.body}
        authorHandle={note.author_handle ?? route.handle}
      />
    );
  }

  // Legacy / no-handle: `/p/{token}` → canonical `/p/{handle}/{id}` when possible.
  if (note.author_handle) {
    permanentRedirect(publicNotePath(note.id, note.author_handle));
  }

  if (route.token !== note.id) {
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

import { auth } from "@clerk/nextjs/server";
import { permanentRedirect, redirect } from "next/navigation";
import { AgentNoteApp } from "@/components/agentnote-app";
import { isValidNoteId } from "@/lib/note-id";
import { listNotes, resolveCanonicalNoteId } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/login");
  }

  const { id } = await params;
  // Invalid format → soft-missing (same as unknown id).
  if (!isValidNoteId(id)) {
    redirect("/");
  }

  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) {
    redirect("/");
  }

  // UUID / legacy short / hyphenless → canonical `xxx-xxxx-xxx`.
  if (id !== canonicalId) {
    permanentRedirect(`/n/${canonicalId}`);
  }

  const notes = await listNotes(userId);

  return (
    <AgentNoteApp
      initialNotes={notes}
      userId={userId}
      initialSelectedId={canonicalId}
    />
  );
}

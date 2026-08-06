import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AgentNoteApp } from "@/components/agentnote-app";
import { mostRecentRootNote } from "@/lib/note-tree";
import { listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/login");
  }

  const notes = await listNotes(userId);
  // Land on the newest root note's deep link so the URL is shareable and the
  // browser back stack can move between notes. Prefer roots over sub-notes
  // (a recently-touched child must not steal the home landing).
  const landing = mostRecentRootNote(notes);
  if (landing) {
    redirect(`/n/${landing.id}`);
  }

  return <AgentNoteApp initialNotes={notes} userId={userId} />;
}

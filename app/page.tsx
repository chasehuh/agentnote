import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AgentNoteApp } from "@/components/agentnote-app";
import { mostRecentNote } from "@/lib/note-tree";
import { listNotes } from "@/lib/notes";

export default async function HomePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/login");
  }

  const notes = await listNotes(userId);
  // Land on the newest note (root or sub-note) so the URL is shareable and
  // the browser back stack can move between notes.
  const landing = mostRecentNote(notes);
  if (landing) {
    redirect(`/n/${landing.id}`);
  }

  return <AgentNoteApp initialNotes={notes} userId={userId} />;
}

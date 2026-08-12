import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AgentNoteApp } from "@/components/agentnote-app";
import { firstNoteInOrder } from "@/lib/note-tree";
import { listNotes } from "@/lib/notes";

export default async function HomePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/login");
  }

  const notes = await listNotes(userId);
  // Land on the top row of the sidebar so the URL is shareable and the browser
  // back stack can move between notes.
  const landing = firstNoteInOrder(notes);
  if (landing) {
    redirect(`/n/${landing.id}`);
  }

  return <AgentNoteApp initialNotes={notes} userId={userId} />;
}

import { MemoApp } from "@/components/memo-app";
import { listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const notes = await listNotes();
  return <MemoApp initialNotes={notes} />;
}

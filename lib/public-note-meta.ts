import { displayNoteTitle } from "./note-title";

export function previewPublicTitle(title: string, body: string) {
  const fromTitle = displayNoteTitle(title);
  if (fromTitle) return fromTitle;
  const firstLine = body.split("\n").find((line) => line.trim());
  return displayNoteTitle(firstLine ?? "") || "Untitled";
}

import { deriveNoteTitle, displayNoteTitle } from "./note-title";

/** Path separators, Windows-reserved punctuation, and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\x00-\x1f\x7f/\\:*?"<>|]/g;
/** Windows device names — a file called `con.md` is not creatable there. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_BASENAME = 80;

/**
 * The `.md` file the export control hands to the browser. Non-ASCII titles are
 * kept as-is — most of these notes are not written in English, and slugging
 * down to `[a-z0-9]` would leave every one of them empty.
 */
export function noteMarkdownFile(body: string, noteId: string) {
  // Most notes open on an ATX heading or a bold line; `#-**Weekly-review**.md`
  // reads badly, and the sidebar shows the same stripped title.
  const base = displayNoteTitle(deriveNoteTitle(body))
    .replace(UNSAFE, " ")
    .trim()
    .slice(0, MAX_BASENAME)
    .replace(/\s+/g, "-")
    // Leading dots hide the file; Windows silently drops trailing dots/spaces.
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");

  return {
    filename: `${base && !RESERVED.test(base) ? base : `note-${noteId}`}.md`,
    // Markdown source exactly as the buffer holds it, POSIX-terminated.
    contents: body.endsWith("\n") ? body : `${body}\n`,
  };
}

/** Client-side download — the body already lives in the buffer, so no round-trip. */
export function downloadNoteMarkdown(body: string, noteId: string) {
  const { filename, contents } = noteMarkdownFile(body, noteId);
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same tick cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Sidebar / tab title = first non-empty body line. Client and server must agree. */
export function deriveNoteTitle(body: string): string {
  return (
    body.split("\n").find((line) => line.trim())?.trim().slice(0, 120) ?? ""
  );
}

/** ATX heading marker — `# Weekly review` is a title, not a title called "#". */
const HEADING = /^#{1,6}\s+/;
/**
 * A whole-string emphasis wrap. The inner group forbids the delimiter so
 * `**a** and **b**` (two spans, not one wrap) and `_snake_case_` stay put.
 * Longest first, so bold-italic `***x***` matches as one wrap, not as `**`.
 */
const WRAPS = [
  /^\*\*\*(?!\*)/,
  /^\*\*(?!\*)/,
  /^\*(?!\*)/,
  /^___(?!_)/,
  /^__(?!_)/,
  /^_(?!_)/,
];

/**
 * Display-only title chrome: the same markers the editor hides live (see
 * `lib/editor/emphasis.ts`) should not resurface in the sidebar, titlebar, or
 * browser tab. People bold their first line, and `**Weekly review**` read as
 * literal asterisks everywhere the editor was not painting.
 *
 * Strips the markers, never the text — the stored body and the markdown export
 * contents are untouched.
 */
export function displayNoteTitle(title: string): string {
  let text = title.trim().replace(HEADING, "").trim();
  for (const open of WRAPS) {
    const mark = text.match(open)?.[0];
    if (!mark) continue;
    // Unclosed (`**Weekly review`) or empty (`****`) wraps are left as typed.
    const inner = text.slice(mark.length, -mark.length);
    if (!text.endsWith(mark) || !inner || inner.includes(mark)) continue;
    text = inner.trim();
  }
  return text;
}

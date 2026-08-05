import type { Note } from "./types";

/** One `#tag` occurrence in a body. `to` is exclusive and covers the `#`. */
export type TagHit = { from: number; to: number; tag: string };

/**
 * `#` + a token starting with a word character. Trailing `-` / `/` is trimmed
 * by the caller so `#work/` yields `work`.
 */
const TAG_RE = /#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

/** ``` or ~~~ fence, allowing CommonMark's up-to-3-space indent. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Markdown link/image destination — `](…)`. `]( #x)` must not read as a tag. */
const LINK_DEST_RE = /\]\([^)]*\)/g;

type Range = [start: number, end: number];

/**
 * Inline code spans on one line, by pairing equal-length backtick runs
 * (CommonMark's rule). Good enough for tag masking; not a full parser.
 */
function inlineCodeRanges(line: string): Range[] {
  const runs: { start: number; len: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < line.length && line[i] === "`") i += 1;
    runs.push({ start, len: i - start });
  }

  const ranges: Range[] = [];
  const paired = new Set<number>();
  for (let a = 0; a < runs.length; a += 1) {
    if (paired.has(a)) continue;
    for (let b = a + 1; b < runs.length; b += 1) {
      if (paired.has(b) || runs[b].len !== runs[a].len) continue;
      ranges.push([runs[a].start, runs[b].start + runs[b].len]);
      paired.add(a);
      paired.add(b);
      break;
    }
  }
  return ranges;
}

function linkDestRanges(line: string): Range[] {
  const ranges: Range[] = [];
  for (const match of line.matchAll(LINK_DEST_RE)) {
    const from = match.index ?? 0;
    ranges.push([from, from + match[0].length]);
  }
  return ranges;
}

/**
 * Every `#tag` in a body, in document order.
 *
 * A tag is `#` followed by a word character and then word characters, `-`, or
 * `/`, and it must contain at least one non-digit — so `#1` and `#42` stay
 * issue references, matching Obsidian. The `#` must start a line or follow
 * whitespace, which is what keeps `# Heading` (space after `#`), `##`, and
 * URL fragments like `/docs#install` out.
 *
 * Fenced code blocks, inline code spans, and link destinations are skipped.
 * Indented (4-space) code blocks are not — a known v1 gap.
 */
export function parseTags(body: string): TagHit[] {
  const hits: TagHit[] = [];
  let offset = 0;
  let fenceChar: string | null = null;

  for (const line of body.split("\n")) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const char = fence[1][0];
      if (fenceChar === null) {
        fenceChar = char;
        offset += line.length + 1;
        continue;
      }
      if (char === fenceChar) {
        fenceChar = null;
        offset += line.length + 1;
        continue;
      }
    }
    if (fenceChar !== null) {
      offset += line.length + 1;
      continue;
    }

    const masked = [...inlineCodeRanges(line), ...linkDestRanges(line)];
    for (const match of line.matchAll(TAG_RE)) {
      const from = match.index ?? 0;
      // Start of line (i.e. after a newline) or preceded by whitespace.
      if (from > 0 && !/\s/.test(line[from - 1])) continue;
      if (masked.some(([start, end]) => from >= start && from < end)) continue;

      const raw = match[1].replace(/[-/]+$/, "");
      if (!raw || !/\D/.test(raw)) continue;

      hits.push({
        from: offset + from,
        to: offset + from + 1 + raw.length,
        tag: raw.toLowerCase(),
      });
    }
    offset += line.length + 1;
  }

  return hits;
}

/** Distinct tags in one body, lowercased, in first-appearance order. */
export function tagsInBody(body: string): string[] {
  const seen = new Set<string>();
  for (const hit of parseTags(body)) seen.add(hit.tag);
  return [...seen];
}

/** Every tag across the user's notes, deduped and sorted for stable UI order. */
export function allTags(notes: Pick<Note, "body">[]): string[] {
  const seen = new Set<string>();
  for (const note of notes) {
    for (const tag of tagsInBody(note.body)) seen.add(tag);
  }
  return [...seen].sort();
}

export function noteHasTag(body: string, tag: string): boolean {
  return tagsInBody(body).includes(tag.toLowerCase());
}

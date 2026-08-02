import {
  ensureSyntaxTree,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorState,
  RangeSetBuilder,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";

const hideMark = Decoration.replace({});
const linkLabelMark = Decoration.mark({ class: "cm-md-link" });
const bareLinkMark = Decoration.mark({ class: "cm-md-link cm-md-link--bare" });

/** Bare http(s) URLs in the buffer (not inside `](…)` destinations). */
const BARE_LINK_RE = /https?:\/\/[^\s)<>]+/g;

/** In-app note deep link: `/n/{id}`. */
const IN_APP_NOTE_PATH_RE = /^\/n\/([^/?#]+)\/?$/;

export type LinkHit = { from: number; to: number; url: string };

function collectMarkdownLinks(state: EditorState): {
  hits: LinkHit[];
  hide: { from: number; to: number }[];
  labels: { from: number; to: number }[];
} {
  ensureSyntaxTree(state, state.doc.length, 50);
  const hits: LinkHit[] = [];
  const hide: { from: number; to: number }[] = [];
  const labels: { from: number; to: number }[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Link" && node.name !== "Autolink") return;

      let urlFrom = -1;
      let urlTo = -1;
      let labelFrom = -1;
      let labelTo = -1;
      let sawOpenBracket = false;
      const marks: { from: number; to: number; text: string }[] = [];

      const cursor = node.node.cursor();
      if (!cursor.firstChild()) return;
      do {
        if (cursor.name === "URL") {
          urlFrom = cursor.from;
          urlTo = cursor.to;
        } else if (cursor.name === "LinkMark") {
          const text = state.doc.sliceString(cursor.from, cursor.to);
          marks.push({ from: cursor.from, to: cursor.to, text });
          if (text === "[") {
            sawOpenBracket = true;
            labelFrom = cursor.to;
          } else if (text === "]" && sawOpenBracket && labelTo < 0) {
            labelTo = cursor.from;
          }
        }
      } while (cursor.nextSibling());

      if (urlFrom < 0) return;
      const url = state.doc.sliceString(urlFrom, urlTo);

      if (node.name === "Autolink") {
        // Keep the URL visible; hide only <…> wrappers.
        for (const mark of marks) hide.push({ from: mark.from, to: mark.to });
        labels.push({ from: urlFrom, to: urlTo });
        hits.push({ from: urlFrom, to: urlTo, url });
        return;
      }

      // [label](url) — hide chrome + destination; show label as the link.
      for (const mark of marks) hide.push({ from: mark.from, to: mark.to });
      hide.push({ from: urlFrom, to: urlTo });
      if (labelFrom >= 0 && labelTo > labelFrom) {
        labels.push({ from: labelFrom, to: labelTo });
        hits.push({ from: labelFrom, to: labelTo, url });
      }
    },
  });

  return { hits, hide, labels };
}

/** Collect bare http(s) URLs that are not already covered by markdown links. */
export function collectBareLinks(
  state: EditorState,
  occupied: LinkHit[],
): LinkHit[] {
  return findBareLinksInText(state.doc.toString(), occupied);
}

/** Pure helper for unit tests — same rules as the editor bare-link scanner. */
export function findBareLinksInText(
  doc: string,
  occupied: Pick<LinkHit, "from" | "to">[] = [],
): LinkHit[] {
  const hits: LinkHit[] = [];
  for (const match of doc.matchAll(BARE_LINK_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (occupied.some((hit) => !(to <= hit.from || from >= hit.to))) continue;
    // Skip destinations inside markdown image / link markup.
    if (from >= 2 && doc.slice(from - 2, from) === "](") continue;
    hits.push({ from, to, url: match[0] });
  }
  return hits;
}

function buildHideDecorations(state: EditorState): DecorationSet {
  const { hide } = collectMarkdownLinks(state);
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...hide].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of sorted) {
    if (range.from >= range.to) continue;
    builder.add(range.from, range.to, hideMark);
  }
  return builder.finish();
}

function buildLabelDecorations(state: EditorState): DecorationSet {
  const md = collectMarkdownLinks(state);
  const bare = collectBareLinks(state, md.hits);
  const builder = new RangeSetBuilder<Decoration>();
  const items = [
    ...md.labels.map((range) => ({ ...range, deco: linkLabelMark })),
    ...bare.map((hit) => ({
      from: hit.from,
      to: hit.to,
      deco: bareLinkMark,
    })),
  ].sort((a, b) => a.from - b.from || a.to - b.to);

  for (const item of items) {
    if (item.from >= item.to) continue;
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

const hiddenLinkMarks = StateField.define<DecorationSet>({
  create: buildHideDecorations,
  update(deco, tr) {
    if (tr.docChanged) return buildHideDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

const visibleLinkMarks = StateField.define<DecorationSet>({
  create: buildLabelDecorations,
  update(deco, tr) {
    if (tr.docChanged) return buildLabelDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Allow only http(s), mailto, in-app `/n/{id}`, and legacy `?n=` / `/?n=`
 * query forms. Rejects `javascript:` and other unknown schemes.
 */
export function resolveHref(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith("?n=") || url.startsWith("/?n=")) return url;
  if (IN_APP_NOTE_PATH_RE.test(url.split(/[?#]/, 2)[0] ?? url)) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  return null;
}

/** Extract note id from `/n/{id}` or legacy `?n=` / `/?n=` hrefs. */
export function noteIdFromInAppHref(href: string): string | null {
  const pathOnly = href.split(/[?#]/, 2)[0] ?? href;
  const pathMatch = pathOnly.match(IN_APP_NOTE_PATH_RE);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return pathMatch[1];
    }
  }

  const noteQuery = href.match(/^[/?]*\?n=([^&]+)$/);
  if (noteQuery?.[1]) {
    try {
      return decodeURIComponent(noteQuery[1]);
    } catch {
      return noteQuery[1];
    }
  }
  return null;
}

function linkAt(state: EditorState, pos: number): string | null {
  const md = collectMarkdownLinks(state);
  const bare = collectBareLinks(state, md.hits);
  for (const hit of [...md.hits, ...bare]) {
    if (pos >= hit.from && pos <= hit.to) return resolveHref(hit.url);
  }
  return null;
}

function openNoteById(noteId: string) {
  // History / selection is owned by AgentNoteApp.selectNote.
  window.dispatchEvent(
    new CustomEvent("agentnote:open-note", { detail: { id: noteId } }),
  );
}

export function openHref(href: string) {
  const noteId = noteIdFromInAppHref(href);
  if (noteId) {
    openNoteById(noteId);
    return;
  }

  if (/^mailto:/i.test(href)) {
    window.location.assign(href);
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

function linkClickHandler() {
  return EditorView.domEventHandlers({
    click(event, view) {
      if (event.shiftKey || event.altKey || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const href = linkAt(view.state, pos);
      if (!href) return false;
      event.preventDefault();
      openHref(href);
      return true;
    },
  });
}

/** Obsidian-style links: `[label](url)` chrome hidden; label / bare URL clickable. */
export function agentnoteLinks(): Extension {
  return [hiddenLinkMarks, visibleLinkMarks, linkClickHandler()];
}

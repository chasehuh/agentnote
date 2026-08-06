import {
  ensureSyntaxTree,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";

const hideMark = Decoration.replace({});
const linkLabelMark = Decoration.mark({ class: "cm-md-link" });
const bareLinkMark = Decoration.mark({ class: "cm-md-link cm-md-link--bare" });
/**
 * Source-mode chrome for a link the caret is editing.
 *
 * Deliberately *not* a `cm-md-link` class token: `tryOpenLinkAtPointer` matches
 * `el.closest(".cm-md-link")`, so an unwrapped link cannot be click-opened and a
 * plain click just places the caret. (`.cm-md-link--bare` keeps opening because
 * its spec carries `cm-md-link` as a separate token.)
 */
const linkSourceMark = Decoration.mark({ class: "cm-md-link-src" });
const linkSourceLabelMark = Decoration.mark({ class: "cm-md-link-src-label" });

/**
 * Bare URLs in the buffer (not inside `](…)` destinations):
 * - http(s)://…
 * - www.…
 * - host.tld[/path] (scheme-less; resolved to https://)
 */
const BARE_LINK_RE =
  /(?:https?:\/\/|www\.)[^\s)<>]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/[^\s)<>]*)?/gi;

/** In-app note deep link: `/n/{id}`. */
const IN_APP_NOTE_PATH_RE = /^\/n\/([^/?#]+)\/?$/;

/**
 * Filename-ish "TLDs" — reject bare `README.md` / `foo.ts` when there is no
 * path/query (still allow `docs.sume.com/…`).
 */
const FILE_LIKE_TLDS = new Set([
  "md",
  "mdx",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "css",
  "scss",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "pdf",
  "txt",
  "html",
  "htm",
  "yml",
  "yaml",
  "toml",
  "lock",
  "map",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "sh",
  "env",
]);

export type LinkHit = { from: number; to: number; url: string };

/** Full markdown span of a link: `[label](url)` or `<url>`, chrome included. */
export type LinkSpan = { from: number; to: number };

/**
 * The link span containing `pos`, when `pos` is **strictly** inside it.
 *
 * Boundaries are excluded on purpose: `pos === from` (before `[`) and
 * `pos === to` (after `)`) are "next to the chip", not "in it", so breaking or
 * typing there keeps working exactly as it does outside a link, and walking off
 * the end of a link re-rolls it instead of leaving it stuck open.
 *
 * Uses `resolveInner` rather than the full-document `documentTree().iterate()`
 * of `collectMarkdownLinks` — this runs on every selection change, so it has to
 * stay O(log n). The cost is that a link past the parsed region (#84/#85) is not
 * found yet; that self-corrects, because the fields below recompute on parse
 * progress too.
 */
export function linkSpanAt(state: EditorState, pos: number): LinkSpan | null {
  const inner = syntaxTree(state).resolveInner(pos, -1);
  for (let node: typeof inner | null = inner; node; node = node.parent) {
    if (node.name === "Link" || node.name === "Autolink") {
      return pos > node.from && pos < node.to
        ? { from: node.from, to: node.to }
        : null;
    }
  }
  return null;
}

/**
 * Links the user is editing right now — the ones painted as source instead of
 * rolled up.
 *
 * Only selection *endpoints* count. A sweep-select or ⌘A that happens to span a
 * link leaves it rolled up: reflowing every link in the document into source
 * because the user selected a paragraph would be worse than useless.
 *
 * Published `/p/…` notes mount this extension too — there is nothing to edit
 * there, so a reader dragging across a link should never see raw markup.
 */
function collectActiveLinks(state: EditorState): readonly LinkSpan[] {
  if (state.readOnly) return [];
  const spans: LinkSpan[] = [];
  for (const range of state.selection.ranges) {
    const ends = range.empty ? [range.head] : [range.anchor, range.head];
    for (const pos of ends) {
      const span = linkSpanAt(state, pos);
      if (span && !spans.some((seen) => seen.from === span.from)) {
        spans.push(span);
      }
    }
  }
  return spans.sort((a, b) => a.from - b.from);
}

function sameSpans(a: readonly LinkSpan[], b: readonly LinkSpan[]): boolean {
  return (
    a.length === b.length &&
    a.every((span, i) => span.from === b[i]?.from && span.to === b[i]?.to)
  );
}

/**
 * Which links are unwrapped for editing.
 *
 * Returns the previous array by identity when the set is unchanged, so the
 * decoration fields below can decide whether to rebuild with a reference
 * compare instead of re-walking the document on every caret move.
 */
const activeLinks = StateField.define<readonly LinkSpan[]>({
  create: collectActiveLinks,
  update(prev, tr) {
    if (
      !tr.docChanged &&
      !tr.selection &&
      syntaxTree(tr.startState) === syntaxTree(tr.state)
    ) {
      return prev;
    }
    const next = collectActiveLinks(tr.state);
    return sameSpans(prev, next) ? prev : next;
  },
});

function activeLinkSpans(state: EditorState): readonly LinkSpan[] {
  return state.field(activeLinks, false) ?? [];
}

/** Milliseconds granted to finish parsing before falling back to a partial tree. */
const PARSE_BUDGET_MS = 50;

/**
 * The most complete syntax tree available for the whole document.
 *
 * `ensureSyntaxTree` advances the language field's *shared, mutable* parse
 * context and returns the resulting tree, but `syntaxTree(state)` reads the
 * snapshot taken when the `LanguageState` was constructed — which is still the
 * pre-parse one. Reading that snapshot is why a note opened with a link past the
 * initially parsed region painted raw `[label](/n/id)` until the first edit
 * produced a `LanguageState` carrying the advanced tree.
 *
 * The fallback covers a parse that ran out of budget: a partial tree still
 * decorates everything it does cover, and the fields below rebuild when the
 * background parser gets further.
 */
function documentTree(state: EditorState) {
  return (
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ??
    syntaxTree(state)
  );
}

function collectMarkdownLinks(
  state: EditorState,
  active: readonly LinkSpan[] = [],
): {
  /** Clickable span = visible link text only (label / autolink URL). */
  hits: LinkHit[];
  hide: { from: number; to: number }[];
  labels: { from: number; to: number }[];
  /** Unwrapped links: full markdown span + the label inside it. */
  sources: { from: number; to: number }[];
  sourceLabels: { from: number; to: number }[];
} {
  const hits: LinkHit[] = [];
  const hide: { from: number; to: number }[] = [];
  const labels: { from: number; to: number }[] = [];
  const sources: { from: number; to: number }[] = [];
  const sourceLabels: { from: number; to: number }[] = [];

  documentTree(state).iterate({
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

      // Autolinks show their URL as the label; `[label](url)` shows the label.
      const isAutolink = node.name === "Autolink";
      const textFrom = isAutolink ? urlFrom : labelFrom;
      const textTo = isAutolink ? urlTo : labelTo;
      const hasText = textFrom >= 0 && textTo > textFrom;

      // `hits` stays unconditional: it answers "what does this position link
      // to", which callers (bare-link occupancy, hrefAtPos) need either way.
      if (hasText) hits.push({ from: textFrom, to: textTo, url });

      const editing = active.some(
        (span) => span.from === node.from && span.to === node.to,
      );
      if (editing) {
        // Editing this one: leave every character in place. Skipping the `hide`
        // ranges drops the atomic ranges with them, since the atomic facet is
        // derived from the same field.
        sources.push({ from: node.from, to: node.to });
        if (hasText) sourceLabels.push({ from: textFrom, to: textTo });
        return;
      }

      // Hide the `<…>` wrappers of an autolink, and the chrome + destination of
      // a `[label](url)`; the remaining visible text is what stays clickable.
      for (const mark of marks) hide.push({ from: mark.from, to: mark.to });
      if (!isAutolink) hide.push({ from: urlFrom, to: urlTo });
      if (hasText) labels.push({ from: textFrom, to: textTo });
    },
  });

  return { hits, hide, labels, sources, sourceLabels };
}

/** Collect bare http(s) URLs that are not already covered by markdown links. */
export function collectBareLinks(
  state: EditorState,
  occupied: LinkHit[],
): LinkHit[] {
  return findBareLinksInText(state.doc.toString(), occupied);
}

/**
 * True for scheme-less strings that look like a web host (+ optional path).
 * Examples: `docs.sume.com/enterprise/mobidoo`, `www.example.com`, `example.com:443/a`.
 */
export function looksLikeWebHost(raw: string): boolean {
  const url = raw.trim();
  if (!url || /\s/.test(url)) return false;
  if (url.startsWith("/") || url.startsWith(".") || url.startsWith("#")) {
    return false;
  }
  if (url.includes("://")) return false;
  // Reject other schemes (`javascript:`, `mailto:`, …) — handled separately.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;

  const hostPart = url.split(/[/?#]/, 1)[0] ?? "";
  if (!hostPart) return false;

  const hostMatch = /^(.+?)(?::(\d{1,5}))?$/.exec(hostPart);
  if (!hostMatch?.[1]) return false;
  const host = hostMatch[1];
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
      host,
    )
  ) {
    return false;
  }

  const labels = host.split(".");
  const tld = labels[labels.length - 1]?.toLowerCase() ?? "";
  if (tld.length < 2 || /^\d+$/.test(tld)) return false;
  // `README.md` / `app.tsx` without a path should not become https links.
  if (FILE_LIKE_TLDS.has(tld) && !/[/?#]/.test(url)) return false;

  return true;
}

/** Pure helper for unit tests — same rules as the editor bare-link scanner. */
export function findBareLinksInText(
  doc: string,
  occupied: Pick<LinkHit, "from" | "to">[] = [],
): LinkHit[] {
  const hits: LinkHit[] = [];
  for (const match of doc.matchAll(BARE_LINK_RE)) {
    const from = match.index ?? 0;
    const raw = match[0];
    const to = from + raw.length;
    if (occupied.some((hit) => !(to <= hit.from || from >= hit.to))) continue;
    // Skip destinations inside markdown image / link markup.
    if (from >= 2 && doc.slice(from - 2, from) === "](") continue;
    // Drop false positives the regex alone cannot filter (e.g. `README.md`).
    if (!resolveHref(raw)) continue;
    hits.push({ from, to, url: raw });
  }
  return hits;
}

function buildHideDecorations(state: EditorState): DecorationSet {
  const { hide } = collectMarkdownLinks(state, activeLinkSpans(state));
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...hide].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of sorted) {
    if (range.from >= range.to) continue;
    builder.add(range.from, range.to, hideMark);
  }
  return builder.finish();
}

function buildLabelDecorations(state: EditorState): DecorationSet {
  const md = collectMarkdownLinks(state, activeLinkSpans(state));
  const bare = collectBareLinks(state, md.hits);
  const builder = new RangeSetBuilder<Decoration>();
  const items = [
    ...md.labels.map((range) => ({ ...range, deco: linkLabelMark })),
    // A source span always opens one offset before its label (`[` vs the first
    // label char), so nesting never produces an equal-`from` tie the builder
    // would have to order.
    ...md.sources.map((range) => ({ ...range, deco: linkSourceMark })),
    ...md.sourceLabels.map((range) => ({
      ...range,
      deco: linkSourceLabelMark,
    })),
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

/**
 * True when this transaction changed the document or moved the parse forward.
 *
 * Rebuilding on `docChanged` alone is why a long note kept raw link markup after
 * the first edit too: the background parser reports progress through a
 * `Language.setState` transaction that changes no text, so the decorations never
 * caught up with the region it had just parsed. Comparing the tree covers both,
 * and `tr.state` is safe to read here because the language field is installed
 * before these fields, so its value is already computed.
 *
 * The third clause rolls links up and down as the caret moves. `activeLinks`
 * hands back its previous value by identity when the set is unchanged, so plain
 * caret motion outside a link costs one reference compare, not a rebuild —
 * `activeLinks` is listed before these fields in `agentnoteLinks()`, on the same
 * ordering grounds as the language field.
 */
function needsRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
    tr.startState.field(activeLinks, false) !==
      tr.state.field(activeLinks, false)
  );
}

const hiddenLinkMarks = StateField.define<DecorationSet>({
  create: buildHideDecorations,
  update(deco, tr) {
    if (needsRebuild(tr)) return buildHideDecorations(tr.state);
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
    if (needsRebuild(tr)) return buildLabelDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Allow http(s), mailto, in-app `/n/{id}`, legacy `?n=` / `/?n=`,
 * protocol-relative `//host…`, and scheme-less web hosts (→ `https://…`).
 * Rejects `javascript:` and other unknown schemes.
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
  if (url.startsWith("//") && looksLikeWebHost(url.slice(2))) {
    return `https:${url}`;
  }
  if (looksLikeWebHost(url)) {
    return `https://${url}`;
  }
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

/** Resolve a navigable href at a document position inside visible link text. */
export function hrefAtPos(state: EditorState, pos: number): string | null {
  const md = collectMarkdownLinks(state);
  const bare = collectBareLinks(state, md.hits);
  for (const hit of [...md.hits, ...bare]) {
    // Half-open [from, to): only the visible label / bare URL, not hidden chrome.
    if (pos >= hit.from && pos < hit.to) return resolveHref(hit.url);
  }
  return null;
}

function openNoteById(noteId: string) {
  // History / selection is owned by AgentNoteApp.selectNote.
  window.dispatchEvent(
    new CustomEvent("agentnote:open-note", { detail: { id: noteId } }),
  );
}

/** Open http(s) via a real <a> click — more reliable than window.open under CM updates. */
function openExternalInNewTab(href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

  openExternalInNewTab(href);
}

function tryOpenLinkAtPointer(
  event: MouseEvent,
  view: EditorView,
): boolean {
  if (event.shiftKey || event.altKey || event.button !== 0) return false;
  // Cmd/Ctrl-click: let the editor keep native multi-cursor / selection behavior.
  if (event.metaKey || event.ctrlKey) return false;

  // Only the painted label / bare-URL mark — not neighboring text whose
  // posAtCoords can land in a zero-width replaced `](url)` span.
  const target = event.target;
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!el) return false;
  const linkEl = el.closest(".cm-md-link");
  if (!linkEl || !view.contentDOM.contains(linkEl)) return false;

  const coordPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  let href = coordPos != null ? hrefAtPos(view.state, coordPos) : null;
  if (!href) {
    // Coords often map into the hidden URL; fall back to the mark's doc pos.
    try {
      href = hrefAtPos(view.state, view.posAtDOM(linkEl, 0));
    } catch {
      return false;
    }
  }
  if (!href) return false;
  event.preventDefault();
  event.stopPropagation();
  openHref(href);
  return true;
}

function linkClickHandler() {
  // Highest precedence so we win over other contentDOM click handlers, and
  // mousedown so we still open if CM defers the click handler to a microtask
  // (popup / navigation gesture would otherwise be lost under CRDT updates).
  return Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        return tryOpenLinkAtPointer(event, view);
      },
      click(event, view) {
        // If mousedown already handled it, defaultPrevented is set.
        if (event.defaultPrevented) return true;
        return tryOpenLinkAtPointer(event, view);
      },
    }),
  );
}

/**
 * Obsidian Live Preview links.
 *
 * Rolled up: `[label](url)` chrome is replaced away and atomic, the label is
 * clickable, and a plain left-click opens the note / URL.
 *
 * Unwrapped: while a selection endpoint is strictly inside a link's markdown
 * span, that link's chrome is neither hidden nor atomic, so the caret walks it
 * one character at a time and label and URL are editable in place. A plain click
 * inside it places the caret instead of navigating. It re-rolls in the same
 * transaction that moves the caret out — position drives it, never a timer.
 *
 * `activeLinks` comes first: the decoration fields read it out of `tr.state`.
 */
export function agentnoteLinks(): Extension {
  return [activeLinks, hiddenLinkMarks, visibleLinkMarks, linkClickHandler()];
}

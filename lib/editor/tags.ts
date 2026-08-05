import {
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
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
import { parseTags } from "../tags";

const tagMark = Decoration.mark({ class: "cm-tag" });

/** `#query` — same shape as the tag parser, minus the trailing-trim. */
const TAG_TRIGGER = /(?:^|\s)#([A-Za-z0-9_/-]*)$/;

function buildTagDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const hit of parseTags(state.doc.toString())) {
    builder.add(hit.from, hit.to, tagMark);
  }
  return builder.finish();
}

const tagMarks = StateField.define<DecorationSet>({
  create: buildTagDecorations,
  update(deco, tr) {
    if (tr.docChanged) return buildTagDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Open the sidebar filter for the clicked tag. Owned by AgentNoteApp. */
function selectTag(tag: string) {
  window.dispatchEvent(
    new CustomEvent("agentnote:select-tag", { detail: { tag } }),
  );
}

function tagClickHandler(): Extension {
  return EditorView.domEventHandlers({
    click(event, view) {
      const target = event.target;
      const el =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      const tagEl = el?.closest(".cm-tag");
      if (!tagEl || !view.contentDOM.contains(tagEl)) return false;

      const pos = view.posAtDOM(tagEl, 0);
      const hit = parseTags(view.state.doc.toString()).find(
        (item) => pos >= item.from && pos < item.to,
      );
      if (!hit) return false;

      event.preventDefault();
      selectTag(hit.tag);
      return true;
    },
  });
}

/** `#` completion over every tag the user has already used. */
export function tagCompletionSource(knownTags: () => string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(TAG_TRIGGER);
    if (!match) return null;

    const hashAt = match.text.lastIndexOf("#");
    const from = match.from + hashAt;
    const query = match.text.slice(hashAt + 1).toLowerCase();
    if (!query && !context.explicit) return null;

    const options = knownTags()
      .filter((tag) => tag.includes(query))
      .map((tag) => ({ label: `#${tag}`, type: "keyword" as const }));
    if (options.length === 0) return null;

    return { from, to: match.to, options, filter: false };
  };
}

/** Paint `#tag` spans and make them click-to-filter. */
export function agentnoteTags(): Extension {
  return [tagMarks, tagClickHandler()];
}

/** Read-only surfaces (`/p/…`) get the highlight without the click handler. */
export function agentnoteTagHighlight(): Extension {
  return [tagMarks];
}

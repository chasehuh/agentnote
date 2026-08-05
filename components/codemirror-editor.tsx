"use client";

import { useEffect, useRef } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  placeholder,
  highlightActiveLine,
  highlightActiveLineGutter,
  scrollPastEnd,
} from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { applyExternalValue } from "@/lib/editor/apply-external";
import { arrowInputHandler, arrowPasteFilter } from "@/lib/editor/arrow-input";
import { agentnoteBoldKeymap } from "@/lib/editor/bold";
import { imageWidgets } from "@/lib/editor/image-widgets";
import { agentnoteLinks } from "@/lib/editor/links";
import { videoWidgets } from "@/lib/editor/video-widgets";
import { agentnoteLineKillKeymap } from "@/lib/editor/line-kill";
import { agentnoteInsertNewlineContinueMarkup } from "@/lib/editor/list-continue";
import {
  agentnoteListIndentOnTab,
  agentnoteListOutdentOnShiftTab,
  LIST_INDENT_UNIT,
} from "@/lib/editor/list-indent";
import {
  agentnoteCompletion,
  type NoteLinkOptions,
} from "@/lib/editor/note-links";
import { imagePasteDrop } from "@/lib/editor/paste-images";
import { agentnoteTagHighlight, agentnoteTags } from "@/lib/editor/tags";
import {
  agentnoteStrikethroughHighlight,
  agentnoteStrikethroughKeymap,
  agentnoteStrikethroughMarkdown,
} from "@/lib/editor/strikethrough";
import { indentedLineWrapping } from "@/lib/editor/wrap-indent";

type CodeMirrorEditorProps = {
  value?: string;
  wrap: boolean;
  /**
   * CRDT-backed body. When set, CM6 is driven by `yCollab` — `value`,
   * `onChange`, and `onExternalReconcile` are ignored, and undo/redo moves to
   * `Y.UndoManager` so exactly one history implementation is active.
   */
  ytext?: Y.Text;
  awareness?: Awareness | null;
  onChange?: (value: string) => void;
  /**
   * Called when an external `value` cannot be applied (selection conflict /
   * IME composing). Must sync React state from the local CM doc without
   * marking the note dirty or scheduling a save.
   */
  onExternalReconcile?: (value: string) => void;
  autoFocus?: boolean;
  placeholderText?: string;
  /** Published / share view — no edits, no active-line chrome. */
  readOnly?: boolean;
  /**
   * Wiring for `[[` note links and the `/` palette. Omitted (or read-only)
   * mounts the editor without any completion — `/p/…` has no notes list.
   */
  noteLinks?: NoteLinkOptions;
  /** Tags known across the user's notes, for `#` completion. */
  knownTags?: () => string[];
};

function insertSoftTab(view: EditorView) {
  const spaces = LIST_INDENT_UNIT;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: spaces },
    selection: { anchor: from + spaces.length },
    userEvent: "input",
  });
  return true;
}

function editorExtensions(
  wrap: boolean,
  wrapCompartment: Compartment,
  placeholderText: string,
  onChangeRef: { current: ((value: string) => void) | undefined },
  applyingExternal: { current: boolean },
  readOnly: boolean,
  ytext: Y.Text | undefined,
  awareness: Awareness | null | undefined,
  noteLinks: NoteLinkOptions | undefined,
  knownTags: (() => string[]) | undefined,
) {
  return [
    lineNumbers(),
    ...(readOnly
      ? []
      : [
          highlightActiveLine(),
          highlightActiveLineGutter(),
          // yCollab installs its own undo/redo — stacking CM history() on top
          // makes ⌘Z fight itself.
          ...(ytext ? [] : [history()]),
        ]),
    drawSelection(),
    markdown({ extensions: agentnoteStrikethroughMarkdown }),
    agentnoteStrikethroughHighlight(),
    placeholder(placeholderText),
    indentUnit.of(LIST_INDENT_UNIT),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    // Zed soft_wrap: hang continuations under indent + list marker.
    wrapCompartment.of(
      wrap ? [EditorView.lineWrapping, indentedLineWrapping()] : [],
    ),
    ...(readOnly
      ? []
      : [
          // Beat markdown()'s Prec.high Enter continue so non-tight lists
          // don't insert an extra blank line before the next marker.
          Prec.highest(
            keymap.of([
              { key: "Enter", run: agentnoteInsertNewlineContinueMarkup },
            ]),
          ),
          keymap.of([
            {
              key: "Tab",
              run: (view) =>
                agentnoteListIndentOnTab(view) || insertSoftTab(view),
              shift: agentnoteListOutdentOnShiftTab,
            },
            ...(ytext ? yUndoManagerKeymap : historyKeymap),
            ...defaultKeymap.filter((binding) => {
              const key = "key" in binding ? binding.key : null;
              // Tab overridden above; mac Mod-Backspace replaced by agentnoteLineKillKeymap
              if (key === "Tab" || key === "Shift-Tab") return false;
              if ("mac" in binding && binding.mac === "Mod-Backspace")
                return false;
              return true;
            }),
          ]),
          agentnoteLineKillKeymap(),
          agentnoteBoldKeymap(),
          agentnoteStrikethroughKeymap(),
          Prec.high(arrowInputHandler()),
          arrowPasteFilter(),
          imagePasteDrop(),
          // `[[` note links, `/` commands, `#` tags — authoring only.
          ...(noteLinks
            ? [
                agentnoteCompletion({
                  noteLinks,
                  knownTags: knownTags ?? (() => []),
                }),
              ]
            : []),
        ]),
    imageWidgets,
    videoWidgets,
    // Obsidian-style clickable markdown links (edit + readOnly).
    agentnoteLinks(),
    // `#tag` chrome. Published notes get the paint but no click-to-filter —
    // there is no sidebar to filter over there.
    readOnly ? agentnoteTagHighlight() : agentnoteTags(),
    // Zed-like one_page: content-only spacer so gutters stay CM-owned geometry
    scrollPastEnd(),
    // Remote updates arrive as CM transactions, so caret, scroll, and IME
    // composition are preserved by construction — no applyExternalValue.
    ...(ytext && !readOnly ? [yCollab(ytext, awareness ?? null)] : []),
    EditorView.updateListener.of((update) => {
      // CRDT mode mirrors text through the Y.Text observer instead.
      if (readOnly || ytext || !update.docChanged || applyingExternal.current) {
        return;
      }
      onChangeRef.current?.(update.state.doc.toString());
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "var(--c-buffer-size)",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "var(--c-buffer-font)",
        lineHeight: "var(--c-buffer-line-height)",
      },
      ".cm-content": {
        // Neutral caret (Cursor-like) — not accent blue.
        caretColor: "var(--c-editor-fg)",
        color: "var(--c-editor-fg)",
        // Top inset: CM mirrors this into gutter element marginTop via
        // documentPadding — do not also pad .cm-gutters.
        // Bottom padding comes from scrollPastEnd() (content attrs only)
        padding: "20px 28px 0 0",
        minHeight: "100%",
        fontVariantLigatures: "contextual",
        fontFeatureSettings: '"calt" 1',
        tabSize: 4,
      },
      ".cm-line": {
        paddingLeft: "14px",
      },
      ".cm-gutters": {
        backgroundColor: "var(--c-editor)",
        color: "var(--c-editor-line-number)",
        border: "none",
        fontFamily: "var(--c-buffer-font)",
        fontSize: "var(--c-buffer-size)",
        lineHeight: "var(--c-buffer-line-height)",
        // Do NOT set paddingTop here. CM syncs gutters with
        // UpdateContext(..., -documentPadding.top) so the first
        // .cm-gutterElement already gets marginTop = content padding-top.
        // Extra gutter paddingTop double-counts and shifts every number
        // ~one line below its text (y-axis desync).
      },
      ".cm-gutter.cm-lineNumbers": {
        minWidth: "var(--c-gutter-w)",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        paddingRight: "12px",
        minWidth: "2.5em",
        boxSizing: "border-box",
      },
      "&.cm-focused .cm-activeLineGutter, .cm-activeLineGutter": {
        color: "var(--c-editor-active-line-number)",
        backgroundColor: "transparent",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--c-editor-active-line)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--c-selection) !important",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--c-editor-fg)",
      },
      ".cm-placeholder": {
        color: "var(--c-text-placeholder)",
        fontStyle: "normal",
      },
    }),
    EditorView.baseTheme({
      "&.cm-editor.cm-focused": {
        outline: "none",
      },
    }),
  ];
}

export function CodeMirrorEditor({
  value = "",
  wrap,
  ytext,
  awareness,
  onChange,
  onExternalReconcile,
  autoFocus = false,
  placeholderText = "Start typing…",
  readOnly = false,
  noteLinks,
  knownTags,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExternalReconcileRef = useRef(onExternalReconcile);
  // The editor mounts once; completion reads the latest notes/tags through
  // these refs so a new note is linkable without remounting CodeMirror.
  // Synced in an effect (as lib/crdt/use-note-doc.ts does) rather than during
  // render — `useRef(prop)` already seeds the first value, and completion
  // callbacks only fire from user interaction, long after effects flush.
  const noteLinksRef = useRef(noteLinks);
  const knownTagsRef = useRef(knownTags);
  const wrapCompartment = useRef(new Compartment());
  const applyingExternal = useRef(false);

  onChangeRef.current = onChange;
  onExternalReconcileRef.current = onExternalReconcile;

  useEffect(() => {
    noteLinksRef.current = noteLinks;
    knownTagsRef.current = knownTags;
  });

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: ytext ? ytext.toString() : value,
        extensions: editorExtensions(
          wrap,
          wrapCompartment.current,
          placeholderText,
          onChangeRef,
          applyingExternal,
          readOnly,
          ytext,
          awareness,
          noteLinks
            ? {
                candidates: () => noteLinksRef.current?.candidates() ?? [],
                createNote: (title) =>
                  noteLinksRef.current?.createNote(title) ??
                  Promise.resolve(null),
              }
            : undefined,
          () => knownTagsRef.current?.() ?? [],
        ),
      }),
      parent: hostRef.current,
    });

    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; value/wrap sync via separate effects. Parent remounts with key={noteId}.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wrap ? [EditorView.lineWrapping, indentedLineWrapping()] : [],
      ),
    });
  }, [wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // yCollab owns the document in CRDT mode; `value` is not the source of truth.
    if (ytext) return;
    if (view.state.doc.toString() === value) return;
    applyingExternal.current = true;
    try {
      const applied = applyExternalValue(view, value);
      // Conflict / composing: CM (local) wins — reconcile React without
      // going through onChange (which marks dirty and schedules a PUT).
      if (!applied) {
        const local = view.state.doc.toString();
        if (onExternalReconcileRef.current) {
          onExternalReconcileRef.current(local);
        } else {
          onChangeRef.current?.(local);
        }
      }
    } finally {
      applyingExternal.current = false;
    }
  }, [value, ytext]);

  return <div className="zed-cm-host" ref={hostRef} />;
}

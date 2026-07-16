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
import { arrowInputHandler, arrowPasteFilter } from "@/lib/editor/arrow-input";
import { imageWidgets } from "@/lib/editor/image-widgets";
import { agentnoteLineKillKeymap } from "@/lib/editor/line-kill";
import {
  agentnoteListIndentOnTab,
  agentnoteListOutdentOnShiftTab,
  LIST_INDENT_UNIT,
} from "@/lib/editor/list-indent";
import { imagePasteDrop } from "@/lib/editor/paste-images";
import { indentedLineWrapping } from "@/lib/editor/wrap-indent";

type CodeMirrorEditorProps = {
  value: string;
  wrap: boolean;
  onChange?: (value: string) => void;
  autoFocus?: boolean;
  placeholderText?: string;
  /** Published / share view — no edits, no active-line chrome. */
  readOnly?: boolean;
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
) {
  return [
    lineNumbers(),
    ...(readOnly
      ? []
      : [highlightActiveLine(), highlightActiveLineGutter(), history()]),
    drawSelection(),
    markdown(),
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
          keymap.of([
            {
              key: "Tab",
              run: (view) =>
                agentnoteListIndentOnTab(view) || insertSoftTab(view),
              shift: agentnoteListOutdentOnShiftTab,
            },
            ...historyKeymap,
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
          Prec.high(arrowInputHandler()),
          arrowPasteFilter(),
          imagePasteDrop(),
        ]),
    imageWidgets,
    // Zed-like one_page: content-only spacer so gutters stay CM-owned geometry
    scrollPastEnd(),
    EditorView.updateListener.of((update) => {
      if (readOnly || !update.docChanged || applyingExternal.current) return;
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
        caretColor: "var(--c-text-accent)",
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
        borderLeftColor: "var(--c-text-accent)",
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
  value,
  wrap,
  onChange,
  autoFocus = false,
  placeholderText = "Start typing…",
  readOnly = false,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const wrapCompartment = useRef(new Compartment());
  const applyingExternal = useRef(false);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions(
          wrap,
          wrapCompartment.current,
          placeholderText,
          onChangeRef,
          applyingExternal,
          readOnly,
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
    const current = view.state.doc.toString();
    if (current === value) return;
    applyingExternal.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    applyingExternal.current = false;
  }, [value]);

  return <div className="zed-cm-host" ref={hostRef} />;
}

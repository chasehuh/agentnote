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
import { markdown } from "@codemirror/lang-markdown";
import { arrowInputHandler, arrowPasteFilter } from "@/lib/editor/arrow-input";
import { imageWidgets } from "@/lib/editor/image-widgets";
import { memoLineKillKeymap } from "@/lib/editor/line-kill";
import { imagePasteDrop } from "@/lib/editor/paste-images";

type CodeMirrorEditorProps = {
  value: string;
  wrap: boolean;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  placeholderText?: string;
};

function insertSoftTab(view: EditorView) {
  const spaces = "    ";
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
  onChangeRef: { current: (value: string) => void },
  applyingExternal: { current: boolean },
) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    markdown(),
    placeholder(placeholderText),
    wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
    keymap.of([
      {
        key: "Tab",
        run: insertSoftTab,
        shift: () => true,
      },
      ...historyKeymap,
      ...defaultKeymap.filter((binding) => {
        const key = "key" in binding ? binding.key : null;
        // Tab overridden above; mac Mod-Backspace replaced by memoLineKillKeymap
        if (key === "Tab" || key === "Shift-Tab") return false;
        if ("mac" in binding && binding.mac === "Mod-Backspace") return false;
        return true;
      }),
    ]),
    memoLineKillKeymap(),
    Prec.high(arrowInputHandler()),
    arrowPasteFilter(),
    imageWidgets,
    imagePasteDrop(),
    // Zed-like one_page: content-only spacer so gutters stay CM-owned geometry
    scrollPastEnd(),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingExternal.current) return;
      onChangeRef.current(update.state.doc.toString());
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
        // Match content top inset only; do not mirror scroll-beyond padding
        // (% / calc resolves against a different box than .cm-content → drift)
        paddingTop: "20px",
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
        wrap ? EditorView.lineWrapping : [],
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

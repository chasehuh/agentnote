import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { toggleInlineMark } from "./toggle-mark";

const MARK = "**";

/** Toggle `**bold**` — see `toggleInlineMark` for the wrap/unwrap/caret cases. */
export function toggleBold(view: EditorView): boolean {
  return toggleInlineMark(view, MARK);
}

/**
 * Cmd+B / Ctrl+B — Obsidian/Notion-style bold. The sidebar toggle moved to
 * Cmd+Shift+B (components/agentnote-app.tsx) so this binding owns plain Mod-b.
 *
 * On macOS `defaultKeymap` binds emacs-style `Ctrl-b` to cursorCharLeft; `Mod-b`
 * is Cmd there, so the two do not collide. Prec.high anyway, matching
 * `agentnoteStrikethroughKeymap`.
 */
export function agentnoteBoldKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Mod-b",
        run: toggleBold,
        preventDefault: true,
      },
    ]),
  );
}

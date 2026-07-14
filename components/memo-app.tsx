"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@/lib/types";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  applyTheme,
  isAppearance,
  isThemeId,
  type Appearance,
  type ThemeId,
} from "@/lib/themes";
import { PlusIcon, SettingsIcon } from "./icons";
import { SettingsPanel } from "./settings-panel";

type SaveState = "saved" | "saving" | "dirty" | "error";

function previewTitle(note: Pick<Note, "title" | "body">) {
  const fromTitle = note.title.trim();
  if (fromTitle) return fromTitle;
  const firstLine = note.body.split("\n").find((line) => line.trim());
  return firstLine?.trim() || "Untitled";
}

function deriveTitle(body: string) {
  return body.split("\n").find((line) => line.trim())?.trim().slice(0, 120) ?? "";
}

function activeLineNumber(text: string, caret: number) {
  const safe = Math.max(0, Math.min(caret, text.length));
  return text.slice(0, safe).split("\n").length;
}

function sortNotesByRecent(notes: Note[]) {
  return [...notes].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfThatDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfThatDay.getTime()) / 86_400_000,
  );

  if (dayDiff === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
      date,
    );
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function MemoApp({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState(() => sortNotesByRecent(initialNotes));
  const [activeId, setActiveId] = useState<string | null>(
    initialNotes[0]?.id ?? null,
  );
  const [body, setBody] = useState(initialNotes[0]?.body ?? "");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [appearance, setAppearance] =
    useState<Appearance>(DEFAULT_APPEARANCE);
  const [caret, setCaret] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const savedAppearance = window.localStorage.getItem(
      APPEARANCE_STORAGE_KEY,
    );
    const nextTheme =
      savedTheme && isThemeId(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
    const nextAppearance =
      savedAppearance && isAppearance(savedAppearance)
        ? savedAppearance
        : DEFAULT_APPEARANCE;
    setThemeId(nextTheme);
    setAppearance(nextAppearance);
    applyTheme(nextTheme, nextAppearance);
  }, []);

  const selectTheme = useCallback(
    (id: ThemeId) => {
      setThemeId(id);
      applyTheme(id, appearance);
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    },
    [appearance],
  );

  const selectAppearance = useCallback(
    (next: Appearance) => {
      setAppearance(next);
      applyTheme(themeId, next);
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    },
    [themeId],
  );

  const sortedNotes = useMemo(() => sortNotesByRecent(notes), [notes]);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeId) ?? null,
    [notes, activeId],
  );

  const lineCount = Math.max(1, body.split("\n").length);
  const currentLine = activeLineNumber(body, caret);

  const selectNote = useCallback((note: Note) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    skipNextSave.current = true;
    setActiveId(note.id);
    setBody(note.body);
    setSaveState("saved");
    setCaret(0);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  const persist = useCallback(async (id: string, nextBody: string) => {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: deriveTitle(nextBody),
          body: nextBody,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as { note: Note };
      setNotes((prev) =>
        sortNotesByRecent([
          data.note,
          ...prev.filter((note) => note.id !== data.note.id),
        ]),
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (activeNote && activeNote.body === body) return;

    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(activeId, body);
    }, 400);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [activeId, body, activeNote, persist]);

  const createNote = useCallback(async () => {
    const response = await fetch("/api/notes", { method: "POST" });
    if (!response.ok) return;
    const data = (await response.json()) as { note: Note };
    setNotes((prev) => sortNotesByRecent([data.note, ...prev]));
    selectNote(data.note);
    setSidebarOpen(true);
  }, [selectNote]);

  async function removeNote(id: string) {
    const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    setNotes((prev) => {
      const next = sortNotesByRecent(prev.filter((note) => note.id !== id));
      if (activeId === id) {
        const fallback = next[0] ?? null;
        if (fallback) {
          selectNote(fallback);
        } else {
          setActiveId(null);
          setBody("");
          setSaveState("saved");
        }
      }
      return next;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if (meta && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
      if (meta && event.key.toLowerCase() === "\\") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNote]);

  function syncGutterScroll() {
    if (!bodyRef.current || !gutterRef.current) return;
    gutterRef.current.scrollTop = bodyRef.current.scrollTop;
  }

  return (
    <div className="zed-shell">
      <div className="zed-workspace">
        <aside className="zed-panel" data-open={sidebarOpen}>
          <div className="zed-panel__header">
            <span className="zed-panel__title">Notes</span>
            <div className="zed-panel__actions">
              <button
                type="button"
                className="zed-icon-btn"
                onClick={() => void createNote()}
                title="New note (⌘N)"
                aria-label="New note"
              >
                <PlusIcon size={13} />
              </button>
            </div>
          </div>
          <nav className="zed-panel__list">
            {sortedNotes.length === 0 ? (
              <p className="zed-panel__empty">No notes yet</p>
            ) : (
              sortedNotes.map((note) => {
                const active = note.id === activeId;
                const label =
                  note.id === activeId
                    ? previewTitle({ title: deriveTitle(body), body })
                    : previewTitle(note);
                const updatedLabel =
                  note.id === activeId &&
                  (saveState === "dirty" || saveState === "saving")
                    ? "Just now"
                    : formatUpdatedAt(note.updated_at);
                return (
                  <div
                    key={note.id}
                    className="zed-note-item"
                    data-active={active}
                  >
                    <button
                      type="button"
                      className="zed-note-item__hit"
                      onClick={() => selectNote(note)}
                    >
                      <span className="zed-note-item__title">{label}</span>
                      <span className="zed-note-item__date">{updatedLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="zed-note-item__delete"
                      onClick={() => void removeNote(note.id)}
                      aria-label="Delete note"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </nav>
          <div className="zed-panel__footer">
            <button
              type="button"
              className="zed-settings-btn"
              data-active={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              Settings
            </button>
          </div>
        </aside>

        <section className="zed-center">
          {activeId ? (
            <div className="zed-editor">
              <div className="zed-buffer">
                <div className="zed-gutter" ref={gutterRef} aria-hidden>
                  {Array.from({ length: lineCount }, (_, index) => {
                    const line = index + 1;
                    return (
                      <div
                        key={line}
                        className="zed-gutter__line"
                        data-active={line === currentLine}
                      >
                        {line}
                      </div>
                    );
                  })}
                </div>
                <textarea
                  ref={bodyRef}
                  className="zed-editor__body"
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setCaret(event.target.selectionStart);
                  }}
                  onScroll={syncGutterScroll}
                  onSelect={(event) => {
                    setCaret(event.currentTarget.selectionStart);
                  }}
                  onKeyUp={(event) => {
                    setCaret(event.currentTarget.selectionStart);
                  }}
                  onClick={(event) => {
                    setCaret(event.currentTarget.selectionStart);
                  }}
                  placeholder="Start typing…"
                  spellCheck
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <div className="zed-empty">
              <p>No open note</p>
              <p className="zed-empty__hint">⌘B notes · ⌘N new</p>
              <button
                type="button"
                className="zed-link"
                onClick={() => void createNote()}
              >
                Create a note
              </button>
            </div>
          )}
        </section>
      </div>

      <SettingsPanel
        open={settingsOpen}
        themeId={themeId}
        appearance={appearance}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={selectTheme}
        onAppearanceChange={selectAppearance}
        onLock={() => void logout()}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@/lib/types";
import { substituteAsciiArrows } from "@/lib/arrows";
import { extractMarkdownImages, markdownImage } from "@/lib/media";
import {
  measureWrappedRowCounts,
  unitRowCounts,
} from "@/lib/gutter";
import {
  DEFAULT_WRAP,
  WRAP_STORAGE_KEY,
  isWrapPreference,
} from "@/lib/preferences";
import {
  createTabId,
  openSyncChannel,
  type SyncMessage,
} from "@/lib/tab-sync";
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
import { MenuIcon, PlusIcon, SettingsIcon } from "./icons";
import { SettingsPanel } from "./settings-panel";

type SaveState = "saved" | "saving" | "dirty" | "error";

const POLL_MS = 1500;
const DRAFT_BROADCAST_MS = 32;
/** Phone-width only — keep tablet/desktop browser windows on the desktop layout. */
const NARROW_QUERY = "(max-width: 480px)";

async function uploadImageFile(file: File): Promise<string> {
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error || `Upload failed (${response.status})`);
  }
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error("Upload response missing url");
  return data.url;
}

function isNarrowViewport() {
  return (
    typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches
  );
}

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
  const [body, setBody] = useState(
    () => substituteAsciiArrows(initialNotes[0]?.body ?? "").text,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [appearance, setAppearance] =
    useState<Appearance>(DEFAULT_APPEARANCE);
  const [wrap, setWrap] = useState(DEFAULT_WRAP);
  const [caret, setCaret] = useState(0);
  const [gutterRows, setGutterRows] = useState<number[]>([1]);
  const [gutterLineHeightPx, setGutterLineHeightPx] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const tabId = useRef(createTabId());
  const syncPost = useRef<(message: SyncMessage) => void>(() => {});
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);
  const bodyRefState = useRef(body);
  const saveStateRef = useRef(saveState);
  const notesRef = useRef(notes);

  activeIdRef.current = activeId;
  bodyRefState.current = body;
  saveStateRef.current = saveState;
  notesRef.current = notes;

  useLayoutEffect(() => {
    if (pendingCaretRef.current == null || !bodyRef.current) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    bodyRef.current.setSelectionRange(pos, pos);
  }, [body]);

  const applyRemoteNote = useCallback((note: Note, opts?: { forceBody?: boolean }) => {
    setNotes((prev) => {
      const existing = prev.find((item) => item.id === note.id);
      if (
        existing &&
        new Date(existing.updated_at).getTime() > new Date(note.updated_at).getTime()
      ) {
        return prev;
      }
      return sortNotesByRecent([
        note,
        ...prev.filter((item) => item.id !== note.id),
      ]);
    });

    if (activeIdRef.current !== note.id) return;
    if (
      !opts?.forceBody &&
      (saveStateRef.current === "dirty" || saveStateRef.current === "saving")
    ) {
      return;
    }
    const nextBody = substituteAsciiArrows(note.body).text;
    if (bodyRefState.current === nextBody) return;
    skipNextSave.current = true;
    setBody(nextBody);
    setSaveState("saved");
  }, []);

  const applyRemoteDraft = useCallback(
    (payload: Extract<SyncMessage, { type: "draft" }>) => {
      if (payload.sourceId === tabId.current) return;
      const nextBody = substituteAsciiArrows(payload.body).text;
      setNotes((prev) => {
        const existing = prev.find((item) => item.id === payload.id);
        if (!existing) return prev;
        return sortNotesByRecent([
          {
            ...existing,
            title: payload.title,
            body: nextBody,
            updated_at: new Date(payload.at).toISOString(),
          },
          ...prev.filter((item) => item.id !== payload.id),
        ]);
      });
      if (activeIdRef.current !== payload.id) return;
      if (bodyRefState.current === nextBody) return;
      skipNextSave.current = true;
      setBody(nextBody);
      setSaveState("saved");
    },
    [],
  );

  const broadcastDraft = useCallback((id: string, nextBody: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      syncPost.current({
        type: "draft",
        sourceId: tabId.current,
        id,
        body: nextBody,
        title: deriveTitle(nextBody),
        at: Date.now(),
      });
    }, DRAFT_BROADCAST_MS);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const savedAppearance = window.localStorage.getItem(
      APPEARANCE_STORAGE_KEY,
    );
    const savedWrap = isWrapPreference(
      window.localStorage.getItem(WRAP_STORAGE_KEY),
    );
    const nextTheme =
      savedTheme && isThemeId(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
    const nextAppearance =
      savedAppearance && isAppearance(savedAppearance)
        ? savedAppearance
        : DEFAULT_APPEARANCE;
    setThemeId(nextTheme);
    setAppearance(nextAppearance);
    setWrap(savedWrap ?? DEFAULT_WRAP);
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

  const selectWrap = useCallback((next: boolean) => {
    setWrap(next);
    window.localStorage.setItem(WRAP_STORAGE_KEY, String(next));
  }, []);

  const sortedNotes = useMemo(() => sortNotesByRecent(notes), [notes]);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeId) ?? null,
    [notes, activeId],
  );

  const lineCount = Math.max(1, body.split("\n").length);
  const currentLine = activeLineNumber(body, caret);
  const bodyImages = useMemo(() => extractMarkdownImages(body), [body]);

  const insertAtCaret = useCallback((snippet: string) => {
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? caret;
    const end = textarea?.selectionEnd ?? caret;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const needsLeadingNewline =
      before.length > 0 && !before.endsWith("\n") && !snippet.startsWith("\n");
    const needsTrailingNewline =
      after.length > 0 && !after.startsWith("\n") && !snippet.endsWith("\n");
    const block =
      (needsLeadingNewline ? "\n" : "") +
      snippet +
      (needsTrailingNewline ? "\n" : "");
    const nextRaw = before + block + after;
    const nextCaret = before.length + block.length;
    const next = substituteAsciiArrows(nextRaw, nextCaret);
    pendingCaretRef.current = next.caret;
    setBody(next.text);
    setCaret(next.caret);
  }, [body, caret]);

  const uploadAndInsertImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      try {
        for (const file of images) {
          const url = await uploadImageFile(file);
          const alt = file.name.replace(/\.[^.]+$/, "") || "image";
          insertAtCaret(markdownImage(url, alt));
        }
      } catch (error) {
        console.error("image upload failed", error);
      }
    },
    [insertAtCaret],
  );

  const refreshGutterMetrics = useCallback(() => {
    const textarea = bodyRef.current;
    if (!textarea) return;

    const style = window.getComputedStyle(textarea);
    const lineHeightPx = parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
      setGutterLineHeightPx(lineHeightPx);
    }

    // Fallback when field-sizing isn't supported: grow textarea with content
    // so .zed-buffer (not the textarea) remains the scrollport.
    if (!CSS.supports("field-sizing", "content")) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }

    if (!wrap) {
      setGutterRows(unitRowCounts(lineCount));
      return;
    }

    setGutterRows(measureWrappedRowCounts(textarea, body));
  }, [body, wrap, lineCount]);

  useEffect(() => {
    refreshGutterMetrics();
  }, [refreshGutterMetrics]);

  useEffect(() => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const observer = new ResizeObserver(() => {
      refreshGutterMetrics();
    });
    observer.observe(buffer);
    return () => observer.disconnect();
  }, [refreshGutterMetrics, activeId]);

  const selectNote = useCallback((note: Note) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const nextBody = substituteAsciiArrows(note.body).text;
    // Persist migration when opening notes that still store ASCII `->`.
    skipNextSave.current = nextBody === note.body;
    setActiveId(note.id);
    setBody(nextBody);
    setSaveState(nextBody === note.body ? "saved" : "dirty");
    setCaret(0);
    if (isNarrowViewport()) setSidebarOpen(false);
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
      syncPost.current({
        type: "upsert",
        sourceId: tabId.current,
        note: data.note,
      });
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
    broadcastDraft(activeId, body);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(activeId, body);
    }, 400);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [activeId, body, activeNote, persist, broadcastDraft]);

  const pullFromServer = useCallback(async () => {
    try {
      const response = await fetch("/api/notes", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { notes: Note[] };
      const remoteNotes = data.notes;
      const localById = new Map(
        notesRef.current.map((note) => [note.id, note] as const),
      );

      for (const remote of remoteNotes) {
        const local = localById.get(remote.id);
        if (
          !local ||
          new Date(remote.updated_at).getTime() >
            new Date(local.updated_at).getTime()
        ) {
          applyRemoteNote(remote);
        }
      }

      const remoteIds = new Set(remoteNotes.map((note) => note.id));
      const missing = notesRef.current.filter((note) => !remoteIds.has(note.id));
      if (missing.length > 0) {
        setNotes((prev) =>
          sortNotesByRecent(prev.filter((note) => remoteIds.has(note.id))),
        );
        if (
          activeIdRef.current &&
          !remoteIds.has(activeIdRef.current)
        ) {
          const fallback = sortNotesByRecent(
            remoteNotes,
          )[0] ?? null;
          if (fallback) {
            const nextBody = substituteAsciiArrows(fallback.body).text;
            skipNextSave.current = nextBody === fallback.body;
            setActiveId(fallback.id);
            setBody(nextBody);
            setSaveState(nextBody === fallback.body ? "saved" : "dirty");
          } else {
            setActiveId(null);
            setBody("");
            setSaveState("saved");
          }
        }
      }
    } catch {
      // Keep local state if the network blips.
    }
  }, [applyRemoteNote]);

  useEffect(() => {
    const channel = openSyncChannel((message) => {
      if (message.sourceId === tabId.current) return;
      if (message.type === "draft") {
        applyRemoteDraft(message);
        return;
      }
      if (message.type === "upsert") {
        applyRemoteNote(message.note, { forceBody: true });
        return;
      }
      if (message.type === "delete") {
        setNotes((prev) => {
          const next = sortNotesByRecent(
            prev.filter((note) => note.id !== message.id),
          );
          if (activeIdRef.current === message.id) {
            const fallback = next[0] ?? null;
            skipNextSave.current = true;
            if (fallback) {
              setActiveId(fallback.id);
              setBody(substituteAsciiArrows(fallback.body).text);
            } else {
              setActiveId(null);
              setBody("");
            }
            setSaveState("saved");
          }
          return next;
        });
      }
    });
    syncPost.current = channel.post;

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pullFromServer();
      }
    }, POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") {
        void pullFromServer();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      channel.close();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [applyRemoteDraft, applyRemoteNote, pullFromServer]);

  const createNote = useCallback(async () => {
    const response = await fetch("/api/notes", { method: "POST" });
    if (!response.ok) return;
    const data = (await response.json()) as { note: Note };
    setNotes((prev) => sortNotesByRecent([data.note, ...prev]));
    syncPost.current({
      type: "upsert",
      sourceId: tabId.current,
      note: data.note,
    });
    selectNote(data.note);
    if (!isNarrowViewport()) setSidebarOpen(true);
  }, [selectNote]);

  async function removeNote(id: string) {
    const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    syncPost.current({
      type: "delete",
      sourceId: tabId.current,
      id,
    });
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

  return (
    <div className="zed-shell">
      <div className="zed-workspace">
        <aside
          className="zed-panel"
          data-open={sidebarOpen}
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen ? true : undefined}
        >
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
              <button
                type="button"
                className="zed-text-btn"
                onClick={() => setSidebarOpen(false)}
                title="Hide notes (⌘B)"
              >
                Hide
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
              <div className="zed-buffer" ref={bufferRef}>
                <div
                  className="zed-gutter"
                  ref={gutterRef}
                  data-wrap={wrap ? "true" : "false"}
                  aria-hidden
                >
                  {Array.from({ length: lineCount }, (_, index) => {
                    const line = index + 1;
                    const rows = gutterRows[index] ?? 1;
                    return (
                      <div
                        key={line}
                        className="zed-gutter__line"
                        data-active={line === currentLine}
                        style={
                          wrap && gutterLineHeightPx > 0
                            ? { height: `${rows * gutterLineHeightPx}px` }
                            : undefined
                        }
                      >
                        {line}
                      </div>
                    );
                  })}
                </div>
                <div className="zed-editor-column">
                  <textarea
                    ref={bodyRef}
                    className="zed-editor__body"
                    data-wrap={wrap ? "true" : "false"}
                    value={body}
                    rows={1}
                    onChange={(event) => {
                      const next = substituteAsciiArrows(
                        event.target.value,
                        event.target.selectionStart,
                      );
                      if (next.text !== event.target.value) {
                        pendingCaretRef.current = next.caret;
                      }
                      setBody(next.text);
                      setCaret(next.caret);
                    }}
                    onPaste={(event) => {
                      const items = event.clipboardData?.items;
                      if (!items) return;
                      const files: File[] = [];
                      for (const item of items) {
                        if (item.kind === "file" && item.type.startsWith("image/")) {
                          const file = item.getAsFile();
                          if (file) files.push(file);
                        }
                      }
                      if (files.length === 0) return;
                      event.preventDefault();
                      void uploadAndInsertImages(files);
                    }}
                    onDrop={(event) => {
                      const files = [...event.dataTransfer.files].filter((file) =>
                        file.type.startsWith("image/"),
                      );
                      if (files.length === 0) return;
                      event.preventDefault();
                      void uploadAndInsertImages(files);
                    }}
                    onDragOver={(event) => {
                      if (
                        [...event.dataTransfer.items].some(
                          (item) =>
                            item.kind === "file" && item.type.startsWith("image/"),
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Tab") return;
                      if (event.metaKey || event.ctrlKey || event.altKey) return;
                      // Zed-like hard_tabs: false — Tab inserts spaces; avoid focus steal.
                      event.preventDefault();
                      if (event.shiftKey) return;

                      const textarea = event.currentTarget;
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      const spaces = "    ";
                      const next = substituteAsciiArrows(
                        body.slice(0, start) + spaces + body.slice(end),
                        start + spaces.length,
                      );
                      pendingCaretRef.current = next.caret;
                      setBody(next.text);
                      setCaret(next.caret);
                    }}
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
                  {bodyImages.length > 0 ? (
                    <div className="zed-image-previews">
                      {bodyImages.map((image) => (
                        <a
                          key={`${image.index}-${image.url}`}
                          className="zed-image-previews__item"
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.url} alt={image.alt || ""} />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div
                    className="zed-editor__beyond"
                    aria-hidden
                    onMouseDown={(event) => {
                      event.preventDefault();
                      const textarea = bodyRef.current;
                      if (!textarea) return;
                      textarea.focus();
                      const end = textarea.value.length;
                      textarea.setSelectionRange(end, end);
                      setCaret(end);
                    }}
                    onDragOver={(event) => {
                      if (
                        [...event.dataTransfer.items].some(
                          (item) =>
                            item.kind === "file" && item.type.startsWith("image/"),
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      const files = [...event.dataTransfer.files].filter((file) =>
                        file.type.startsWith("image/"),
                      );
                      if (files.length === 0) return;
                      event.preventDefault();
                      void uploadAndInsertImages(files);
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="zed-empty">
              <p>No open note</p>
              <p className="zed-empty__hint">⌘B notes · ⌘N new</p>
              <div className="zed-empty__actions">
                <button
                  type="button"
                  className="zed-btn zed-btn-primary"
                  onClick={() => setSidebarOpen(true)}
                >
                  Notes
                </button>
                <button
                  type="button"
                  className="zed-btn"
                  onClick={() => void createNote()}
                >
                  New note
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {!sidebarOpen ? (
        <button
          type="button"
          className="zed-notes-fab"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open notes"
          title="Notes"
        >
          <MenuIcon size={16} />
        </button>
      ) : null}

      <SettingsPanel
        open={settingsOpen}
        themeId={themeId}
        appearance={appearance}
        wrap={wrap}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={selectTheme}
        onAppearanceChange={selectAppearance}
        onWrapChange={selectWrap}
        onLock={() => void logout()}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@/lib/types";
import { substituteAsciiArrows } from "@/lib/arrows";
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
import { ARCHIVE_RETENTION_DAYS, daysUntilArchivePurge } from "@/lib/archive";
import { AccountMenu } from "./account-menu";
import { CodeMirrorEditor } from "./codemirror-editor";
import { ConfirmDialog } from "./confirm-dialog";
import {
  PlusIcon,
  SidebarLeftClosedIcon,
  SidebarLeftOpenIcon,
} from "./icons";
import { PublishPanel } from "./publish-panel";
import { ReloadToUpdate } from "./reload-to-update";
import { SettingsPanel } from "./settings-panel";

type SaveState = "saved" | "saving" | "dirty" | "error";

const POLL_MS = 1500;
const DRAFT_BROADCAST_MS = 32;
/** Phone-width only — keep tablet/desktop browser windows on the desktop layout. */
const NARROW_QUERY = "(max-width: 480px)";

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

function sortNotesByRecent(notes: Note[]) {
  return [...notes].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

function sortArchivedByDeleted(notes: Note[]) {
  return [...notes].sort((a, b) => {
    const aMs = a.deleted_at ? new Date(a.deleted_at).getTime() : 0;
    const bMs = b.deleted_at ? new Date(b.deleted_at).getTime() : 0;
    return bMs - aMs;
  });
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

function resolveInitialNote(
  notes: Note[],
  initialSelectedId?: string,
): Note | null {
  if (initialSelectedId) {
    const match = notes.find((note) => note.id === initialSelectedId);
    if (match) return match;
  }
  return notes[0] ?? null;
}

function notePath(id: string | null) {
  return id ? `/n/${id}` : "/";
}

/** Soft URL sync — avoids App Router remount when switching notes. */
function replaceNoteUrl(id: string | null) {
  const next = notePath(id);
  if (window.location.pathname === next) return;
  window.history.replaceState(window.history.state, "", next);
}

export function AgentNoteApp({
  initialNotes,
  userId,
  initialSelectedId,
}: {
  initialNotes: Note[];
  userId: string;
  /** When set (deep link `/n/{id}`), open that note; otherwise first note / empty. */
  initialSelectedId?: string;
}) {
  const [notes, setNotes] = useState(() => sortNotesByRecent(initialNotes));
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Note | null>(null);
  const [pendingPermanent, setPendingPermanent] = useState<Note | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => {
    return resolveInitialNote(initialNotes, initialSelectedId)?.id ?? null;
  });
  const [body, setBody] = useState(() => {
    const initial = resolveInitialNote(initialNotes, initialSelectedId);
    return substituteAsciiArrows(initial?.body ?? "").text;
  });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [appearance, setAppearance] =
    useState<Appearance>(DEFAULT_APPEARANCE);
  const [wrap, setWrap] = useState(DEFAULT_WRAP);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
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

  const clearActiveNote = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    skipNextSave.current = true;
    setActiveId(null);
    setBody("");
    setSaveState("saved");
    replaceNoteUrl(null);
  }, []);

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
    replaceNoteUrl(note.id);
    if (isNarrowViewport()) setSidebarOpen(false);
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
      const [liveRes, archivedRes] = await Promise.all([
        fetch("/api/notes", { cache: "no-store" }),
        fetch("/api/notes?archived=1", { cache: "no-store" }),
      ]);
      if (!liveRes.ok) return;
      const data = (await liveRes.json()) as { notes: Note[] };
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
            replaceNoteUrl(fallback.id);
          } else {
            clearActiveNote();
          }
        }
      }

      if (archivedRes.ok) {
        const archivedData = (await archivedRes.json()) as { notes: Note[] };
        setArchivedNotes(sortArchivedByDeleted(archivedData.notes));
      }
    } catch {
      // Keep local state if the network blips.
    }
  }, [applyRemoteNote, clearActiveNote]);

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
      if (message.type === "archive") {
        setNotes((prev) => {
          const next = sortNotesByRecent(
            prev.filter((note) => note.id !== message.note.id),
          );
          if (activeIdRef.current === message.note.id) {
            const fallback = next[0] ?? null;
            skipNextSave.current = true;
            if (fallback) {
              setActiveId(fallback.id);
              setBody(substituteAsciiArrows(fallback.body).text);
              replaceNoteUrl(fallback.id);
            } else {
              setActiveId(null);
              setBody("");
              replaceNoteUrl(null);
            }
            setSaveState("saved");
          }
          return next;
        });
        setArchivedNotes((prev) =>
          sortArchivedByDeleted([
            message.note,
            ...prev.filter((note) => note.id !== message.note.id),
          ]),
        );
        return;
      }
      if (message.type === "restore") {
        setArchivedNotes((prev) =>
          prev.filter((note) => note.id !== message.note.id),
        );
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
              replaceNoteUrl(fallback.id);
            } else {
              setActiveId(null);
              setBody("");
              replaceNoteUrl(null);
            }
            setSaveState("saved");
          }
          return next;
        });
        setArchivedNotes((prev) =>
          prev.filter((note) => note.id !== message.id),
        );
      }
    }, userId);
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
  }, [applyRemoteDraft, applyRemoteNote, pullFromServer, userId]);

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

  function requestArchive(note: Note) {
    setPendingArchive(note);
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setConfirmBusy(true);
    try {
      const response = await fetch(`/api/notes/${pendingArchive.id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { note?: Note };
      const archived =
        data.note ??
        ({
          ...pendingArchive,
          deleted_at: new Date().toISOString(),
          is_public: false,
          public_id: null,
          published_at: null,
          author_handle: null,
        } satisfies Note);
      const id = archived.id;
      syncPost.current({
        type: "archive",
        sourceId: tabId.current,
        note: archived,
      });
      setNotes((prev) => {
        const next = sortNotesByRecent(prev.filter((note) => note.id !== id));
        if (activeIdRef.current === id) {
          const fallback = next[0] ?? null;
          if (fallback) {
            selectNote(fallback);
          } else {
            clearActiveNote();
          }
        }
        return next;
      });
      setArchivedNotes((prev) =>
        sortArchivedByDeleted([
          archived,
          ...prev.filter((note) => note.id !== id),
        ]),
      );
      setArchivedOpen(true);
    } finally {
      setConfirmBusy(false);
      setPendingArchive(null);
    }
  }

  async function restoreArchived(note: Note) {
    const response = await fetch(`/api/notes/${note.id}/restore`, {
      method: "POST",
    });
    if (!response.ok) return;
    const data = (await response.json()) as { note: Note };
    syncPost.current({
      type: "restore",
      sourceId: tabId.current,
      note: data.note,
    });
    setArchivedNotes((prev) => prev.filter((item) => item.id !== data.note.id));
    setNotes((prev) =>
      sortNotesByRecent([
        data.note,
        ...prev.filter((item) => item.id !== data.note.id),
      ]),
    );
    selectNote(data.note);
  }

  function requestPermanentDelete(note: Note) {
    setPendingPermanent(note);
  }

  async function confirmPermanentDelete() {
    if (!pendingPermanent) return;
    setConfirmBusy(true);
    try {
      const id = pendingPermanent.id;
      const response = await fetch(`/api/notes/${id}?permanent=1`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      syncPost.current({
        type: "delete",
        sourceId: tabId.current,
        id,
      });
      setArchivedNotes((prev) => prev.filter((note) => note.id !== id));
    } finally {
      setConfirmBusy(false);
      setPendingPermanent(null);
    }
  }

  const tabTitle = activeId
    ? previewTitle({ title: deriveTitle(body), body })
    : "agentnote";

  // Browser tab: page title only (Notion-style). Shell stays "agentnote".
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);

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
      {/* Zed-like chrome: full-width titlebar; left dock toggle (⌘B) */}
      <header className="zed-titlebar">
        <button
          type="button"
          className="zed-icon-btn"
          data-active={sidebarOpen ? "true" : "false"}
          onClick={() => setSidebarOpen((value) => !value)}
          title={sidebarOpen ? "Hide notes (⌘B)" : "Show notes (⌘B)"}
          aria-label={sidebarOpen ? "Hide notes" : "Show notes"}
          aria-pressed={sidebarOpen}
        >
          {sidebarOpen ? (
            <SidebarLeftOpenIcon size={14} />
          ) : (
            <SidebarLeftClosedIcon size={14} />
          )}
        </button>
        <span className="zed-titlebar__title" title={tabTitle}>
          {tabTitle}
        </span>
        <div className="zed-titlebar__spacer" />
        <button
          type="button"
          className="zed-titlebar__publish"
          data-active={activeNote?.is_public ? "true" : "false"}
          onClick={() => setPublishOpen(true)}
          disabled={!activeId}
          title={
            !activeId
              ? "Open a note to publish"
              : activeNote?.is_public
                ? "Published — manage link"
                : "Publish note"
          }
        >
          {activeNote?.is_public ? "Published" : "Publish"}
        </button>
        <ReloadToUpdate />
        <AccountMenu onOpenSettings={() => setSettingsOpen(true)} />
      </header>

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
                <PlusIcon size={14} />
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
                      <span
                        className="zed-note-item__title"
                        data-public={note.is_public ? "true" : undefined}
                      >
                        {label}
                      </span>
                      <span className="zed-note-item__date">{updatedLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="zed-note-item__delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        requestArchive(note);
                      }}
                      aria-label="Archive note"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </nav>
          {archivedNotes.length > 0 ? (
            <div className="zed-panel__archived">
              <button
                type="button"
                className="zed-panel__archived-toggle"
                onClick={() => setArchivedOpen((value) => !value)}
                aria-expanded={archivedOpen}
              >
                <span>Archived</span>
                <span>{archivedNotes.length}</span>
              </button>
              {archivedOpen ? (
                <div className="zed-panel__archived-list">
                  {archivedNotes.map((note) => {
                    const daysLeft = note.deleted_at
                      ? daysUntilArchivePurge(note.deleted_at)
                      : ARCHIVE_RETENTION_DAYS;
                    return (
                      <div key={note.id} className="zed-note-item">
                        <div className="zed-note-item__hit" style={{ cursor: "default" }}>
                          <span className="zed-note-item__title">
                            {previewTitle(note)}
                          </span>
                          <span className="zed-note-item__meta">
                            Deletes in {daysLeft}d
                          </span>
                        </div>
                        <div className="zed-note-item__actions">
                          <button
                            type="button"
                            className="zed-note-item__restore"
                            onClick={() => void restoreArchived(note)}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="zed-note-item__purge"
                            onClick={() => requestPermanentDelete(note)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="zed-center">
          {activeId ? (
            <div className="zed-editor">
              <div className="zed-buffer zed-buffer--cm">
                <CodeMirrorEditor
                  key={activeId}
                  value={body}
                  wrap={wrap}
                  onChange={setBody}
                  autoFocus
                />
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

      <SettingsPanel
        open={settingsOpen}
        themeId={themeId}
        appearance={appearance}
        wrap={wrap}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={selectTheme}
        onAppearanceChange={selectAppearance}
        onWrapChange={selectWrap}
      />

      <PublishPanel
        open={publishOpen}
        note={activeNote}
        onClose={() => setPublishOpen(false)}
        onNoteChange={(note) => {
          setNotes((prev) =>
            sortNotesByRecent([
              note,
              ...prev.filter((item) => item.id !== note.id),
            ]),
          );
          syncPost.current({
            type: "upsert",
            sourceId: tabId.current,
            note,
          });
        }}
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        title="Move to Archived?"
        description={`You can restore “${pendingArchive ? previewTitle(pendingArchive) : "this note"}” for ${ARCHIVE_RETENTION_DAYS} days.`}
        confirmLabel="Archive"
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setPendingArchive(null);
        }}
        onConfirm={() => void confirmArchive()}
      />

      <ConfirmDialog
        open={pendingPermanent !== null}
        title="Delete forever?"
        description={`“${pendingPermanent ? previewTitle(pendingPermanent) : "This note"}” will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete forever"
        danger
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setPendingPermanent(null);
        }}
        onConfirm={() => void confirmPermanentDelete()}
      />
    </div>
  );
}

"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Note } from "@/lib/types";
import { substituteAsciiArrows } from "@/lib/arrows";
import {
  useNoteDoc,
  type NoteDocProjection,
} from "@/lib/crdt/use-note-doc";
import { crdtSyncChrome } from "@/lib/crdt/sync-chrome";
import { deriveNoteTitle } from "@/lib/note-title";
import {
  ancestorIds,
  collapsibleIds,
  flattenNoteTree,
  mostRecentRootNote,
  type NoteTreeRow,
} from "@/lib/note-tree";
import { allTags, noteHasTag } from "@/lib/tags";
import {
  DEFAULT_WRAP,
  TREE_COLLAPSED_STORAGE_KEY,
  WRAP_STORAGE_KEY,
  isWrapPreference,
  parseCollapsedIds,
} from "@/lib/preferences";
import { bodyFingerprint } from "@/lib/body-fingerprint";
import {
  canAdvanceBaseWithoutAdopting,
  canApplyRemoteBody,
  isDraftBaseContentCurrent,
  isDraftBaseCurrent,
  isRemoteNoteNewer,
  shouldAcceptDraftSeq,
  shouldMarkSavedAfterPersist,
} from "@/lib/remote-apply-guard";
import {
  classifySaveHttpStatus,
  hasUnsavedWork,
  isCurrentSaveAttempt,
  nextRetryDelayMs,
  shouldAutoRetrySave,
  type SaveFailureKind,
} from "@/lib/save-failure";
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
  ChevronRightIcon,
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
/**
 * Route the note body through the Yjs CRDT instead of whole-document `PUT`.
 * Off restores the legacy optimistic-concurrency path exactly; note that a note
 * already seeded server-side stays CRDT-managed (see README).
 */
const CRDT_ENABLED = process.env.NEXT_PUBLIC_AGENTNOTE_CRDT === "1";
/**
 * Realtime (Hocuspocus) server for the CRDT path. Unset keeps the HTTP + poll
 * transport, so rolling realtime back is one variable.
 */
const COLLAB_URL =
  process.env.NEXT_PUBLIC_AGENTNOTE_COLLAB_URL?.trim() || null;
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
  // Home / empty deep-link: newest root only — never open a nested sub-note.
  return mostRecentRootNote(notes);
}

function notePath(id: string | null) {
  return id ? `/n/${id}` : "/";
}

type NoteUrlMode = "push" | "replace" | "none";

/**
 * Soft URL sync — avoids App Router remount when switching notes.
 * `push` records history so the browser back button moves between notes;
 * `replace` is for involuntary jumps (archive fallback, etc.).
 */
function syncNoteUrl(id: string | null, mode: NoteUrlMode = "replace") {
  if (mode === "none") return;
  const next = notePath(id);
  if (window.location.pathname === next) return;
  if (mode === "push") {
    window.history.pushState({ noteId: id }, "", next);
  } else {
    window.history.replaceState({ noteId: id }, "", next);
  }
}

function noteIdFromPath(pathname: string): string | null {
  const match = /^\/n\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ?? null;
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
  // Realtime handshake token. Clerk rotates it, so the provider re-reads it on
  // every (re)connect rather than holding one.
  const { getToken } = useAuth();
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
  const [saveErrorKind, setSaveErrorKind] = useState<SaveFailureKind | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Active `#tag` sidebar filter. Null = show everything. */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  /**
   * Note-tree rows whose children are hidden. Collapsed rather than expanded
   * ids so a note nobody has touched — including one just created — defaults to
   * visible under its parent.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [appearance, setAppearance] =
    useState<Appearance>(DEFAULT_APPEARANCE);
  const [wrap, setWrap] = useState(DEFAULT_WRAP);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const saveSeqRef = useRef(0);
  /** In-flight persist promise — flush must await this to avoid self-409. */
  const persistInFlightRef = useRef<Promise<boolean> | null>(null);
  const persistRef = useRef<
    (
      id: string,
      nextBody: string,
      opts?: { isRetry?: boolean },
    ) => Promise<boolean>
  >(async () => false);
  const skipNextSave = useRef(false);
  const tabId = useRef(createTabId());
  const syncPost = useRef<(message: SyncMessage) => void>(() => {});
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSeqRef = useRef(0);
  const lastDraftSeqByPeer = useRef(new Map<string, number>());
  const activeIdRef = useRef(activeId);
  const collapsedRef = useRef<ReadonlySet<string>>(collapsed);
  const bodyRefState = useRef(body);
  const saveStateRef = useRef(saveState);
  const notesRef = useRef(notes);
  const lastAckedBodyRef = useRef(body);
  /**
   * Server generation the editor buffer is based on. Advances only when the
   * buffer adopts server state (open / clean remote apply / own ack), never
   * from a refused remote body — see `persist`.
   */
  const baseUpdatedAtRef = useRef(
    resolveInitialNote(initialNotes, initialSelectedId)?.updated_at ?? "",
  );
  /**
   * RAW server body at `baseUpdatedAtRef`'s generation (pre arrow-substitution).
   * Advances only alongside the base token — never from a peer draft, whose
   * text is unacked. Its fingerprint lets drafts and PUTs prove their base
   * CONTENT, not just its timestamp: a poll can advance the list row past a
   * stale dirty buffer, and a token alone is then launderable (0804 clobber).
   */
  const baseBodyRef = useRef(
    resolveInitialNote(initialNotes, initialSelectedId)?.body ?? "",
  );
  /**
   * Buffer value the autosave effect last processed. A poll/broadcast can
   * replace `activeNote` while the buffer is untouched; only a buffer change
   * may arm autosave — a row refresh must never turn an idle tab into a
   * writer (0804 wipe: that auto-PUT is how the stale body kept winning).
   */
  const lastArmedBodyRef = useRef(body);

  activeIdRef.current = activeId;
  bodyRefState.current = body;
  saveStateRef.current = saveState;
  notesRef.current = notes;

  const clearSaveRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    retryAttemptRef.current = 0;
  }, []);

  // Update refs in the same turn as setState so poll/BroadcastChannel
  // callbacks never observe a 1-frame-stale dirty/body (issue #47 T4).
  const setBodyNow = useCallback((next: string) => {
    bodyRefState.current = next;
    setBody(next);
  }, []);

  const setSaveStateNow = useCallback((next: SaveState) => {
    saveStateRef.current = next;
    setSaveState(next);
  }, []);

  /** Refresh the sidebar row from the server's plaintext projection of the CRDT. */
  const applyDocProjection = useCallback((projection: NoteDocProjection) => {
    setNotes((prev) => {
      const current = prev.find((item) => item.id === projection.noteId);
      if (!current) return prev;
      if (
        current.body === projection.body &&
        current.updated_at === projection.updatedAt
      ) {
        return prev;
      }
      return sortNotesByRecent([
        {
          ...current,
          title: deriveNoteTitle(projection.body),
          body: projection.body,
          updated_at: projection.updatedAt,
        },
        ...prev.filter((item) => item.id !== projection.noteId),
      ]);
    });
    if (activeIdRef.current === projection.noteId) {
      // Keep the legacy tokens coherent so publish/archive still work.
      lastAckedBodyRef.current = projection.body;
      baseUpdatedAtRef.current = projection.updatedAt;
      baseBodyRef.current = projection.body;
    }
  }, []);

  const docSession = useNoteDoc({
    noteId: CRDT_ENABLED ? activeId : null,
    userId,
    enabled: CRDT_ENABLED,
    collabUrl: COLLAB_URL,
    getToken,
    onProjection: applyDocProjection,
  });
  const docFlush = docSession.flush;
  /** The Y.Doc owns the body once it is bound; React state only mirrors it. */
  const displayBody =
    CRDT_ENABLED && docSession.ytext ? docSession.text : body;
  /**
   * The CRDT path has no dirty/conflict states — edits always merge, so the
   * only failure worth surfacing is "the server is unreachable".
   */
  const displaySaveState: SaveState = CRDT_ENABLED
    ? docSession.status === "offline"
      ? "error"
      : "saved"
    : saveState;
  const displaySaveErrorKind: SaveFailureKind | null = CRDT_ENABLED
    ? docSession.status === "offline"
      ? "generic"
      : null
    : saveErrorKind;

  const applyRemoteNote = useCallback((note: Note, opts?: { forceBody?: boolean }) => {
    const existing = notesRef.current.find((item) => item.id === note.id);
    // Equal-or-older remote must not replace local list/body (issue #51).
    if (existing && !isRemoteNoteNewer(existing.updated_at, note.updated_at)) {
      return;
    }

    setNotes((prev) =>
      sortNotesByRecent([
        note,
        ...prev.filter((item) => item.id !== note.id),
      ]),
    );

    if (activeIdRef.current !== note.id) return;
    // CRDT-backed body is owned by the Y.Doc — the list row may advance, the
    // editor buffer never adopts a whole-document remote body.
    if (CRDT_ENABLED) return;

    const nextBody = substituteAsciiArrows(note.body).text;
    // Body-neutral generation bump (publish / unpublish / restore rewrite only
    // `updated_at`): the server body our buffer is based on is unchanged, so
    // advance the token even while dirty — otherwise the next save would be a
    // false conflict.
    if (canAdvanceBaseWithoutAdopting(nextBody, lastAckedBodyRef.current)) {
      baseUpdatedAtRef.current = note.updated_at;
      baseBodyRef.current = note.body;
    }

    if (
      !canApplyRemoteBody(saveStateRef.current, {
        ...opts,
        localBody: bodyRefState.current,
        lastAckedBody: lastAckedBodyRef.current,
      })
    ) {
      return;
    }
    if (bodyRefState.current === nextBody) {
      lastAckedBodyRef.current = nextBody;
      baseUpdatedAtRef.current = note.updated_at;
      baseBodyRef.current = note.body;
      return;
    }
    skipNextSave.current = true;
    setBodyNow(nextBody);
    lastAckedBodyRef.current = nextBody;
    baseUpdatedAtRef.current = note.updated_at;
    baseBodyRef.current = note.body;
    setSaveErrorKind(null);
    setSaveStateNow("saved");
  }, [setBodyNow, setSaveStateNow]);

  const reconcileBodyFromEditor = useCallback(
    (next: string) => {
      // Skipped external apply: keep CM as source of truth in React without
      // marking dirty or arming the autosave timer (issue #51).
      if (bodyRefState.current === next) return;
      skipNextSave.current = true;
      setBodyNow(next);
    },
    [setBodyNow],
  );

  const applyRemoteDraft = useCallback(
    (payload: Extract<SyncMessage, { type: "draft" }>) => {
      if (payload.sourceId === tabId.current) return;
      // CRDT tabs exchange binary `doc-update` messages instead.
      if (CRDT_ENABLED) return;

      const peerKey = `${payload.sourceId}:${payload.id}`;
      const prevSeq = lastDraftSeqByPeer.current.get(peerKey);
      if (!shouldAcceptDraftSeq(prevSeq, payload.draftSeq)) return;
      if (payload.draftSeq != null && Number.isFinite(payload.draftSeq)) {
        lastDraftSeqByPeer.current.set(peerKey, payload.draftSeq);
      }

      const existing = notesRef.current.find((item) => item.id === payload.id);
      if (!existing) return;

      // Stale generation (or missing base from old bundles): never shrink a
      // clean editor from a peer draft (issue #57).
      if (!isDraftBaseCurrent(existing.updated_at, payload.baseUpdatedAt)) {
        return;
      }

      const nextBody = substituteAsciiArrows(payload.body).text;
      setNotes((prev) => {
        const current = prev.find((item) => item.id === payload.id);
        if (!current) return prev;
        // Do not inject client-clock `at` into updated_at — that lets a
        // skewed peer look newer than a real server save (issue #51).
        return sortNotesByRecent([
          {
            ...current,
            title: payload.title,
            body: nextBody,
          },
          ...prev.filter((item) => item.id !== payload.id),
        ]);
      });
      if (activeIdRef.current !== payload.id) return;
      // Generation timestamps can be laundered (post-#73 0804 clobber: a poll
      // advanced the sender's list row past its stale dirty buffer, and the
      // row-stamped draft passed the check above). The sender must also prove
      // its base CONTENT matches ours; missing fingerprint fails closed.
      if (
        !isDraftBaseContentCurrent(
          bodyFingerprint(baseBodyRef.current),
          payload.baseFingerprint,
        )
      ) {
        return;
      }
      // Match applyRemoteNote: never clobber an in-progress local edit.
      if (
        !canApplyRemoteBody(saveStateRef.current, {
          localBody: bodyRefState.current,
          lastAckedBody: lastAckedBodyRef.current,
        })
      ) {
        return;
      }
      if (bodyRefState.current === nextBody) return;
      skipNextSave.current = true;
      setBodyNow(nextBody);
      lastAckedBodyRef.current = nextBody;
      // A draft is unsaved peer text — the gates above proved the generation
      // and its content are unchanged, so the base (token AND `baseBodyRef`)
      // stays put; only server-acked bodies may advance it.
      baseUpdatedAtRef.current = existing.updated_at;
      setSaveErrorKind(null);
      setSaveStateNow("saved");
    },
    [setBodyNow, setSaveStateNow],
  );

  const broadcastDraft = useCallback((id: string, nextBody: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftSeqRef.current += 1;
      syncPost.current({
        type: "draft",
        sourceId: tabId.current,
        id,
        body: nextBody,
        title: deriveNoteTitle(nextBody),
        at: Date.now(),
        // Stamp the BUFFER's own base, never the list row: a poll/upsert can
        // advance the row past a stale dirty buffer, and a row-stamped draft
        // then walks into a clean peer as "current" — that peer's next PUT
        // carries a valid token over stale content (post-#73 0804 clobber).
        baseUpdatedAt: baseUpdatedAtRef.current,
        baseFingerprint: bodyFingerprint(baseBodyRef.current),
        draftSeq: draftSeqRef.current,
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
    const restored = new Set(
      parseCollapsedIds(window.localStorage.getItem(TREE_COLLAPSED_STORAGE_KEY)),
    );
    collapsedRef.current = restored;
    setCollapsed(restored);
  }, []);

  /**
   * Apply and persist a collapsed-set change. Reads through a ref so the
   * localStorage write stays out of the state updater.
   */
  const applyCollapsed = useCallback(
    (next: (prev: ReadonlySet<string>) => ReadonlySet<string>) => {
      const value = next(collapsedRef.current);
      if (value === collapsedRef.current) return;
      collapsedRef.current = value;
      setCollapsed(value);
      window.localStorage.setItem(
        TREE_COLLAPSED_STORAGE_KEY,
        JSON.stringify([...value]),
      );
    },
    [],
  );

  const toggleCollapsed = useCallback(
    (id: string) => {
      applyCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    [applyCollapsed],
  );

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

  /**
   * Sidebar rows in render order.
   *
   * A `#tag` filter renders FLAT on purpose: a filter is a search view, and
   * nesting matches under parents the filter excluded would draw structure the
   * result set does not have.
   */
  const sidebarRows = useMemo<NoteTreeRow[]>(() => {
    if (tagFilter) {
      return sortNotesByRecent(notes)
        .filter((note) => noteHasTag(note.body, tagFilter))
        .map((note) => ({
          note,
          depth: 0,
          hasChildren: false,
          expanded: false,
        }));
    }
    return flattenNoteTree(notes, collapsed);
  }, [notes, tagFilter, collapsed]);

  /** Scanning every body is not free — recompute only when the notes change. */
  const availableTags = useMemo(() => allTags(notes), [notes]);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeId) ?? null,
    [notes, activeId],
  );

  const applyActiveNoteSelection = useCallback(
    (note: Note, opts?: { history?: NoteUrlMode }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      clearSaveRetry();
      const nextBody = substituteAsciiArrows(note.body).text;
      // Persist migration when opening notes that still store ASCII `->`.
      skipNextSave.current = nextBody === note.body;
      setActiveId(note.id);
      setBodyNow(nextBody);
      lastAckedBodyRef.current = nextBody;
      baseUpdatedAtRef.current = note.updated_at;
      baseBodyRef.current = note.body;
      setSaveErrorKind(null);
      setSaveStateNow(nextBody === note.body ? "saved" : "dirty");
      // Default push so sidebar / in-app link navigation builds a back stack.
      syncNoteUrl(note.id, opts?.history ?? "push");
      if (isNarrowViewport()) setSidebarOpen(false);
    },
    [clearSaveRetry, setBodyNow, setSaveStateNow],
  );

  const applyClearActiveNote = useCallback(
    (opts?: { history?: NoteUrlMode }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      clearSaveRetry();
      skipNextSave.current = true;
      setActiveId(null);
      setBodyNow("");
      lastAckedBodyRef.current = "";
      baseUpdatedAtRef.current = "";
      baseBodyRef.current = "";
      setSaveErrorKind(null);
      setSaveStateNow("saved");
      syncNoteUrl(null, opts?.history ?? "push");
    },
    [clearSaveRetry, setBodyNow, setSaveStateNow],
  );

  const persist = useCallback(
    async (
      id: string,
      nextBody: string,
      opts?: { isRetry?: boolean },
    ): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        const seq = ++saveSeqRef.current;
        if (!opts?.isRetry) {
          clearSaveRetry();
        }
        setSaveStateNow("saving");

        const scheduleRetry = () => {
          const delay = nextRetryDelayMs(retryAttemptRef.current);
          if (delay == null) return;
          const attempt = retryAttemptRef.current;
          retryAttemptRef.current = attempt + 1;
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            if (!isCurrentSaveAttempt(seq, saveSeqRef.current)) return;
            if (activeIdRef.current !== id) return;
            void persistRef.current(id, bodyRefState.current, {
              isRetry: true,
            });
          }, delay);
        };

        // The generation this buffer was based on — NOT the newest list row.
        // A poll/broadcast that refreshes the row while refusing the remote
        // body (local unsaved work wins) would otherwise hand a stale buffer a
        // valid token and silently truncate the newer server body (issue #57).
        const expectedUpdatedAt = baseUpdatedAtRef.current;
        if (!expectedUpdatedAt) {
          setSaveErrorKind("generic");
          setSaveStateNow("error");
          return false;
        }
        // Content proof for the token above: the server refuses this PUT when
        // its current body is not the one this buffer is based on, even if the
        // token was laundered onto stale content by a path the client-side
        // guards missed (or by an older bundle still open in another tab).
        const baseFingerprint = bodyFingerprint(baseBodyRef.current);

        try {
          const response = await fetch(`/api/notes/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: deriveNoteTitle(nextBody),
              body: nextBody,
              expected_updated_at: expectedUpdatedAt,
              base_fingerprint: baseFingerprint,
            }),
          });

          if (!isCurrentSaveAttempt(seq, saveSeqRef.current)) {
            return false;
          }

          const kind = classifySaveHttpStatus(response.status);
          if (kind === "conflict") {
            clearSaveRetry();
            let conflictNote: Note | null = null;
            try {
              const data = (await response.json()) as { note?: Note };
              conflictNote = data.note ?? null;
            } catch {
              conflictNote = null;
            }
            if (!isCurrentSaveAttempt(seq, saveSeqRef.current)) {
              return false;
            }
            if (conflictNote) {
              // Show the server's newer note in the list; the buffer keeps the
              // local text. The base token deliberately does NOT advance: a
              // rebase here hands the stale buffer a valid ticket, and any
              // follow-up save silently overwrites the newer body (0804 wipe).
              // Only the explicit conflict actions may take a fresh token.
              const server = conflictNote;
              setNotes((prev) =>
                sortNotesByRecent([
                  server,
                  ...prev.filter((note) => note.id !== server.id),
                ]),
              );
            }
            setSaveErrorKind("conflict");
            setSaveStateNow("error");
            return false;
          }

          if (kind !== "ok") {
            setSaveErrorKind(kind);
            setSaveStateNow("error");
            if (kind === "auth" || !shouldAutoRetrySave(kind)) {
              clearSaveRetry();
              return false;
            }
            scheduleRetry();
            return false;
          }

          const data = (await response.json()) as { note: Note };
          if (!isCurrentSaveAttempt(seq, saveSeqRef.current)) {
            return false;
          }

          clearSaveRetry();
          setSaveErrorKind(null);
          setNotes((prev) =>
            sortNotesByRecent([
              data.note,
              ...prev.filter((note) => note.id !== data.note.id),
            ]),
          );

          // Our write landed: the server is now at this generation regardless of
          // whether the buffer has since advanced.
          baseUpdatedAtRef.current = data.note.updated_at;
          baseBodyRef.current = data.note.body;

          const ackedBody = substituteAsciiArrows(data.note.body).text;
          if (shouldMarkSavedAfterPersist(nextBody, bodyRefState.current)) {
            lastAckedBodyRef.current = ackedBody;
            setSaveStateNow("saved");
          } else {
            // Buffer advanced during the in-flight PUT — stay dirty and ensure
            // a follow-up persist is armed (issue #57 / H4).
            setSaveStateNow("dirty");
            if (!saveTimer.current) {
              saveTimer.current = setTimeout(() => {
                void persistRef.current(id, bodyRefState.current);
              }, 400);
            }
          }

          syncPost.current({
            type: "upsert",
            sourceId: tabId.current,
            note: data.note,
          });
          return true;
        } catch {
          if (!isCurrentSaveAttempt(seq, saveSeqRef.current)) {
            return false;
          }
          setSaveErrorKind("generic");
          setSaveStateNow("error");
          scheduleRetry();
          return false;
        }
      };

      // Serialize persists. Overlapping PUTs carry the same token, so the
      // loser 409s against our own just-landed write and the tab enters the
      // conflict state with no real conflict (0804 RCA: this self-409 is what
      // put a healthy single tab on the stale-buffer path).
      const prior = persistInFlightRef.current;
      const promise = (async () => {
        if (prior) await prior.catch(() => false);
        return run();
      })();
      persistInFlightRef.current = promise;
      try {
        return await promise;
      } finally {
        if (persistInFlightRef.current === promise) {
          persistInFlightRef.current = null;
        }
      }
    },
    [clearSaveRetry, setSaveStateNow],
  );

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const retrySaveNow = useCallback(() => {
    if (CRDT_ENABLED) {
      void docFlush();
      return;
    }
    const id = activeIdRef.current;
    if (!id) return;
    clearSaveRetry();
    void persist(id, bodyRefState.current);
  }, [clearSaveRetry, docFlush, persist]);

  /**
   * Explicit conflict resolution — the ONLY paths that may hand a diverged
   * buffer a fresh concurrency token (0804 wipe: a silent rebase on 409 let
   * a stale short buffer overwrite the newer body with no user decision).
   */
  const resolveConflictOverwrite = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    clearSaveRetry();
    try {
      const response = await fetch(`/api/notes/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { note: Note };
      if (activeIdRef.current !== id) return;
      // The user chose to overwrite the server version with this buffer.
      baseUpdatedAtRef.current = data.note.updated_at;
      baseBodyRef.current = data.note.body;
    } catch {
      return;
    }
    void persist(id, bodyRefState.current);
  }, [clearSaveRetry, persist]);

  const resolveConflictUseServer = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    clearSaveRetry();
    try {
      const response = await fetch(`/api/notes/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { note: Note };
      if (activeIdRef.current !== id) return;
      const nextBody = substituteAsciiArrows(data.note.body).text;
      skipNextSave.current = true;
      setBodyNow(nextBody);
      lastAckedBodyRef.current = nextBody;
      baseUpdatedAtRef.current = data.note.updated_at;
      baseBodyRef.current = data.note.body;
      setNotes((prev) =>
        sortNotesByRecent([
          data.note,
          ...prev.filter((note) => note.id !== data.note.id),
        ]),
      );
      setSaveErrorKind(null);
      setSaveStateNow("saved");
    } catch {
      // Keep the conflict banner; the user can pick an action again.
    }
  }, [clearSaveRetry, setBodyNow, setSaveStateNow]);

  const flushPendingSave = useCallback(async () => {
    if (CRDT_ENABLED) {
      await docFlush();
      return true;
    }
    const id = activeIdRef.current;
    if (!id) return true;
    if (!hasUnsavedWork(saveStateRef.current)) return true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Await in-flight PUT first — a second same-token PUT races under
    // optimistic concurrency and surfaces a self-409 discard prompt (#57).
    if (persistInFlightRef.current) {
      await persistInFlightRef.current;
      if (activeIdRef.current !== id) return false;
      if (!hasUnsavedWork(saveStateRef.current)) return true;
      // That persist may have armed its own follow-up timer when the buffer
      // advanced mid-flight. Drop it, or it fires during our PUT below and
      // races a duplicate same-token write into a self-409 (issue #57).
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    }
    clearSaveRetry();
    return persist(id, bodyRefState.current);
  }, [clearSaveRetry, docFlush, persist]);

  /**
   * Leaving the active note must not discard a dirty/saving/error buffer.
   * Mirror Reload-to-Update: flush first; confirm only if flush fails.
   */
  const ensureSafeToLeaveActive = useCallback(async () => {
    if (CRDT_ENABLED) {
      // Queued updates go out before the doc is torn down; a CRDT never has to
      // ask the user to discard anything.
      await docFlush().catch(() => {});
      return true;
    }
    if (!hasUnsavedWork(saveStateRef.current)) return true;
    let flushed = false;
    try {
      flushed = await flushPendingSave();
    } catch {
      flushed = false;
    }
    if (flushed) return true;
    return window.confirm(
      "You have unsaved changes. Discard them and continue?",
    );
  }, [docFlush, flushPendingSave]);

  const clearActiveNote = useCallback(
    async (opts?: { skipFlush?: boolean }) => {
      if (!opts?.skipFlush) {
        const ok = await ensureSafeToLeaveActive();
        if (!ok) return false;
      }
      applyClearActiveNote();
      return true;
    },
    [applyClearActiveNote, ensureSafeToLeaveActive],
  );

  const selectNote = useCallback(
    async (note: Note, opts?: { skipFlush?: boolean }) => {
      // Re-clicking the active note must not reset a dirty buffer from list state.
      if (activeIdRef.current === note.id) return true;
      if (!opts?.skipFlush) {
        const ok = await ensureSafeToLeaveActive();
        if (!ok) return false;
      }
      applyActiveNoteSelection(note);
      return true;
    },
    [applyActiveNoteSelection, ensureSafeToLeaveActive],
  );

  // In-app markdown links (`/n/{id}`) dispatch from the CM6 link extension.
  useEffect(() => {
    function onOpenNote(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const target = notesRef.current.find((item) => item.id === id);
      // Unknown id: soft no-op (do not navigate the whole app to a 404).
      if (!target || target.id === activeIdRef.current) return;
      void selectNote(target);
    }
    window.addEventListener("agentnote:open-note", onOpenNote);
    return () => {
      window.removeEventListener("agentnote:open-note", onOpenNote);
    };
  }, [selectNote]);

  // Browser back/forward — sync the open note to the URL without pushing again.
  useEffect(() => {
    function onPopState() {
      const id = noteIdFromPath(window.location.pathname);
      if (!id) {
        if (activeIdRef.current !== null) {
          applyClearActiveNote({ history: "none" });
        }
        return;
      }
      const target = notesRef.current.find((item) => item.id === id);
      if (!target || target.id === activeIdRef.current) return;
      applyActiveNoteSelection(target, { history: "none" });
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [applyActiveNoteSelection, applyClearActiveNote]);

  // Clicking a `#tag` in the editor filters the sidebar (lib/editor/tags.ts).
  useEffect(() => {
    function onSelectTag(event: Event) {
      const tag = (event as CustomEvent<{ tag?: string }>).detail?.tag;
      if (!tag) return;
      setTagFilter((prev) => (prev === tag ? null : tag));
      setSidebarOpen(true);
    }
    window.addEventListener("agentnote:select-tag", onSelectTag);
    return () => {
      window.removeEventListener("agentnote:select-tag", onSelectTag);
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    // CRDT path persists through the doc sync loop, not a whole-document PUT.
    if (CRDT_ENABLED) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      lastArmedBodyRef.current = body;
      return;
    }
    if (body === lastArmedBodyRef.current) return;
    lastArmedBodyRef.current = body;
    if (activeNote && activeNote.body === body) return;

    clearSaveRetry();
    setSaveStateNow("dirty");
    broadcastDraft(activeId, body);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(activeId, body);
    }, 400);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    activeId,
    body,
    activeNote,
    persist,
    broadcastDraft,
    clearSaveRetry,
    setSaveStateNow,
  ]);

  useEffect(() => {
    // CRDT edits merge server-side and queued updates flush on `pagehide`, so
    // the body never needs a discard prompt.
    if (CRDT_ENABLED) return;
    if (!hasUnsavedWork(saveState)) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

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
        if (!local || isRemoteNoteNewer(local.updated_at, remote.updated_at)) {
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
          const fallback =
            mostRecentRootNote(remoteNotes) ??
            sortNotesByRecent(remoteNotes)[0] ??
            null;
          if (fallback) {
            // Active note vanished remotely — switch without flushing a ghost id.
            applyActiveNoteSelection(fallback, { history: "replace" });
          } else {
            void clearActiveNote({ skipFlush: true });
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
  }, [
    applyActiveNoteSelection,
    applyRemoteNote,
    clearActiveNote,
  ]);

  useEffect(() => {
    const channel = openSyncChannel((message) => {
      if (message.sourceId === tabId.current) return;
      if (message.type === "draft") {
        applyRemoteDraft(message);
        return;
      }
      if (message.type === "upsert") {
        // Never forceBody on upsert — a stale peer save must not clobber an
        // actively edited buffer (issue #51 / #48 dirty-guard hole).
        applyRemoteNote(message.note);
        return;
      }
      if (message.type === "archive") {
        setNotes((prev) => {
          const next = sortNotesByRecent(
            prev.filter((note) => note.id !== message.note.id),
          );
          if (activeIdRef.current === message.note.id) {
            const fallback = mostRecentRootNote(next) ?? next[0] ?? null;
            skipNextSave.current = true;
            if (fallback) {
              const nextBody = substituteAsciiArrows(fallback.body).text;
              setActiveId(fallback.id);
              setBodyNow(nextBody);
              lastAckedBodyRef.current = nextBody;
              baseUpdatedAtRef.current = fallback.updated_at;
              baseBodyRef.current = fallback.body;
              syncNoteUrl(fallback.id, "replace");
            } else {
              setActiveId(null);
              setBodyNow("");
              lastAckedBodyRef.current = "";
              baseUpdatedAtRef.current = "";
              baseBodyRef.current = "";
              syncNoteUrl(null, "replace");
            }
            setSaveStateNow("saved");
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
            const fallback = mostRecentRootNote(next) ?? next[0] ?? null;
            skipNextSave.current = true;
            if (fallback) {
              const nextBody = substituteAsciiArrows(fallback.body).text;
              setActiveId(fallback.id);
              setBodyNow(nextBody);
              lastAckedBodyRef.current = nextBody;
              baseUpdatedAtRef.current = fallback.updated_at;
              baseBodyRef.current = fallback.body;
              syncNoteUrl(fallback.id, "replace");
            } else {
              setActiveId(null);
              setBodyNow("");
              lastAckedBodyRef.current = "";
              baseUpdatedAtRef.current = "";
              baseBodyRef.current = "";
              syncNoteUrl(null, "replace");
            }
            setSaveStateNow("saved");
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
  }, [
    applyRemoteDraft,
    applyRemoteNote,
    pullFromServer,
    userId,
    setBodyNow,
    setSaveStateNow,
  ]);

  /**
   * Create a note and register it locally, without touching the active note.
   * Shared by ⌘N (which then navigates) and the editor's `[[` / `/` sub-note
   * flow (which must NOT navigate — the user is mid-sentence in the parent).
   */
  const createNoteRow = useCallback(
    async (input?: {
      body?: string;
      /** Owning note for a true sub-note. Omit for a root note (⌘N / `+`). */
      parentId?: string | null;
    }): Promise<Note | null> => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: input?.body ?? "",
          ...(input?.parentId ? { parent_id: input.parentId } : {}),
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { note: Note };
      setNotes((prev) => sortNotesByRecent([data.note, ...prev]));
      syncPost.current({
        type: "upsert",
        sourceId: tabId.current,
        note: data.note,
      });
      return data.note;
    },
    [],
  );

  const createNote = useCallback(async () => {
    const ok = await ensureSafeToLeaveActive();
    if (!ok) return;
    const note = await createNoteRow();
    if (!note) return;
    await selectNote(note, { skipFlush: true });
    if (!isNarrowViewport()) setSidebarOpen(true);
  }, [createNoteRow, ensureSafeToLeaveActive, selectNote]);

  /** `[[` / `/` wiring handed to CodeMirror. Reads live state on each keystroke. */
  const noteLinkOptions = useMemo(
    () => ({
      // The active note is excluded: linking a note to itself is never useful,
      // and it would otherwise sit at the top of the picker.
      candidates: () =>
        notesRef.current
          .filter((note) => note.id !== activeIdRef.current)
          .map((note) => ({
            id: note.id,
            title: previewTitle(note),
          })),
      /**
       * Create-from-inside — the ONLY gesture that nests. Picking an existing
       * note goes through `linkCompletion` and never reaches here, so a link
       * stays a peer hyperlink (see #80).
       *
       * The parent is sent only when the active note is still in the live list:
       * a note archived in another tab would 400 the create and cost the user
       * the text they were typing.
       */
      createNote: async (title: string) => {
        const parentId = activeIdRef.current;
        const parentIsLive =
          parentId != null &&
          notesRef.current.some((note) => note.id === parentId);
        const note = await createNoteRow({
          body: title,
          parentId: parentIsLive ? parentId : null,
        });
        return note ? { id: note.id, title: previewTitle(note) } : null;
      },
    }),
    [createNoteRow],
  );

  const knownTags = useMemo(() => () => allTags(notesRef.current), []);

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
      const wasActive = activeIdRef.current === id;
      const remaining = sortNotesByRecent(
        notesRef.current.filter((note) => note.id !== id),
      );
      setNotes(remaining);
      if (wasActive) {
        const fallback = mostRecentRootNote(remaining) ?? remaining[0] ?? null;
        if (fallback) {
          await selectNote(fallback, { skipFlush: true });
        } else {
          await clearActiveNote({ skipFlush: true });
        }
      }
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
    await selectNote(data.note);
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
    ? previewTitle({ title: deriveNoteTitle(displayBody), body: displayBody })
    : "agentnote";

  /**
   * CRDT sync status — muted titlebar chrome, left of Publish. Its states are
   * all recoverable-by-waiting, so they deliberately do NOT reuse the red
   * `.zed-save-error` block below (which stays for legacy save failures).
   */
  const syncChrome =
    CRDT_ENABLED && activeId ? crdtSyncChrome(docSession.status) : null;

  const saveErrorLabel =
    displaySaveErrorKind === "auth"
      ? "Sign in to save"
      : displaySaveErrorKind === "conflict"
        ? "Conflict"
        : "Not saved";
  const saveErrorTitle =
    displaySaveErrorKind === "auth"
      ? "Session expired — sign in again to save"
      : displaySaveErrorKind === "conflict"
        ? "Another tab or device saved a newer version of this note"
        : "Latest changes are not saved";

  // Browser tab: page title only (Notion-style). Shell stays "agentnote".
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);

  // Zed `project_panel.auto_reveal_entries`: selecting a nested note opens the
  // path down to it, so the active row is never hidden inside a collapsed parent.
  useEffect(() => {
    if (!activeId) return;
    const ancestors = ancestorIds(notesRef.current, activeId);
    if (ancestors.length === 0) return;
    applyCollapsed((prev) => {
      if (!ancestors.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  }, [activeId, notes, applyCollapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      // Zed's `cmd-left` / `cmd-right`: collapse or expand the whole tree.
      // Scoped to a focused sidebar row on purpose — this listener is on
      // `window`, and ⌘← / ⌘→ are line-boundary motions in the editor, so an
      // unscoped binding would swallow them the way plain ⌘B once did.
      const inPanel =
        event.target instanceof Element && event.target.closest(".zed-panel");
      if (meta && inPanel && event.key === "ArrowLeft") {
        event.preventDefault();
        applyCollapsed(() => new Set(collapsibleIds(notesRef.current)));
      }
      if (meta && inPanel && event.key === "ArrowRight") {
        event.preventDefault();
        applyCollapsed(() => new Set());
      }
      // Plain ⌘B is Markdown bold in the editor (lib/editor/bold.ts). This
      // listener must not match it at all: it sits on `window`, so a
      // CodeMirror keymap's preventDefault would not stop it from also firing.
      if (meta && event.shiftKey && event.key.toLowerCase() === "b") {
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
  }, [createNote, applyCollapsed]);

  return (
    <div className="zed-shell">
      {/* Zed-like chrome: full-width titlebar; left dock toggle (⌘⇧B) */}
      <header className="zed-titlebar">
        <button
          type="button"
          className="zed-icon-btn"
          data-active={sidebarOpen ? "true" : "false"}
          onClick={() => setSidebarOpen((value) => !value)}
          title={sidebarOpen ? "Hide notes (⌘⇧B)" : "Show notes (⌘⇧B)"}
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
        {syncChrome ? (
          <div
            className="zed-titlebar__sync"
            role="status"
            title={syncChrome.title}
          >
            <span>{syncChrome.label}</span>
            {syncChrome.retry ? (
              <button
                type="button"
                className="zed-titlebar__sync-action"
                onClick={retrySaveNow}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
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
        {/* Legacy whole-document path only — the CRDT path is never a hard
            error, and reports through `zed-titlebar__sync` above. */}
        {!CRDT_ENABLED && displaySaveState === "error" ? (
          <div className="zed-save-error" role="alert" title={saveErrorTitle}>
            <span>{saveErrorLabel}</span>
            {displaySaveErrorKind === "auth" ? (
              <a className="zed-save-error__action" href="/login">
                Sign in
              </a>
            ) : displaySaveErrorKind === "conflict" ? (
              <>
                <button
                  type="button"
                  className="zed-save-error__action"
                  onClick={() => void resolveConflictUseServer()}
                  title="Discard this buffer and load the newer server version"
                >
                  Use server
                </button>
                <button
                  type="button"
                  className="zed-save-error__action"
                  onClick={() => void resolveConflictOverwrite()}
                  title="Replace the newer server version with this buffer"
                >
                  Overwrite
                </button>
              </>
            ) : (
              <button
                type="button"
                className="zed-save-error__action"
                onClick={retrySaveNow}
              >
                Retry
              </button>
            )}
          </div>
        ) : null}
        <ReloadToUpdate
          hasUnsavedWork={hasUnsavedWork(displaySaveState)}
          onFlushSave={flushPendingSave}
        />
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
          {availableTags.length > 0 ? (
            <div className="zed-panel__tags">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="zed-tag-chip"
                  data-active={tag === tagFilter ? "true" : undefined}
                  aria-pressed={tag === tagFilter}
                  onClick={() =>
                    setTagFilter((prev) => (prev === tag ? null : tag))
                  }
                  title={
                    tag === tagFilter ? `Clear #${tag} filter` : `Filter #${tag}`
                  }
                >
                  #{tag}
                </button>
              ))}
            </div>
          ) : null}
          <nav className="zed-panel__list">
            {sidebarRows.length === 0 ? (
              <p className="zed-panel__empty">
                {tagFilter ? `No notes tagged #${tagFilter}` : "No notes yet"}
              </p>
            ) : (
              sidebarRows.map(({ note, depth, hasChildren, expanded }) => {
                const active = note.id === activeId;
                const label =
                  note.id === activeId
                    ? previewTitle({
                        title: deriveNoteTitle(displayBody),
                        body: displayBody,
                      })
                    : previewTitle(note);
                const updatedLabel =
                  note.id === activeId && displaySaveState === "error"
                    ? CRDT_ENABLED
                      ? "Offline"
                      : "Not saved"
                    : note.id === activeId &&
                        (displaySaveState === "dirty" ||
                          displaySaveState === "saving")
                      ? "Just now"
                      : formatUpdatedAt(note.updated_at);
                return (
                  <div
                    key={note.id}
                    className="zed-note-item"
                    data-active={active}
                    style={{ "--depth": depth } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="zed-note-item__hit"
                      onClick={() => void selectNote(note)}
                      // Zed project-panel arrows: → opens a row, ← closes it.
                      onKeyDown={(event) => {
                        if (!hasChildren) return;
                        if (event.key === "ArrowRight" && !expanded) {
                          event.preventDefault();
                          toggleCollapsed(note.id);
                        }
                        if (event.key === "ArrowLeft" && expanded) {
                          event.preventDefault();
                          toggleCollapsed(note.id);
                        }
                      }}
                    >
                      <span
                        className="zed-note-item__title"
                        data-public={note.is_public ? "true" : undefined}
                      >
                        {label}
                      </span>
                      <span className="zed-note-item__date">{updatedLabel}</span>
                    </button>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="zed-note-item__chevron"
                        data-expanded={expanded ? "true" : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCollapsed(note.id);
                        }}
                        aria-expanded={expanded}
                        aria-label={
                          expanded ? "Collapse sub-notes" : "Expand sub-notes"
                        }
                        title={
                          expanded ? "Collapse sub-notes" : "Expand sub-notes"
                        }
                      >
                        <ChevronRightIcon size={12} />
                      </button>
                    ) : null}
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
                {CRDT_ENABLED ? (
                  docSession.ytext ? (
                    <CodeMirrorEditor
                      key={`${activeId}:crdt`}
                      ytext={docSession.ytext}
                      awareness={docSession.awareness}
                      wrap={wrap}
                      noteLinks={noteLinkOptions}
                      knownTags={knownTags}
                      autoFocus
                    />
                  ) : (
                    // Never edit before the server state lands: a locally seeded
                    // doc merges into duplicated content.
                    <CodeMirrorEditor
                      key={`${activeId}:loading`}
                      value={body}
                      wrap={wrap}
                      readOnly
                    />
                  )
                ) : (
                  <CodeMirrorEditor
                    key={activeId}
                    value={body}
                    wrap={wrap}
                    onChange={setBodyNow}
                    onExternalReconcile={reconcileBodyFromEditor}
                    noteLinks={noteLinkOptions}
                    knownTags={knownTags}
                    autoFocus
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="zed-empty">
              <p>No open note</p>
              <p className="zed-empty__hint">⌘⇧B notes · ⌘N new</p>
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
          // Publish/unpublish bumps `updated_at` without touching the body —
          // advance the base so the next save is not a false conflict (#57).
          if (activeIdRef.current === note.id) {
            baseUpdatedAtRef.current = note.updated_at;
            baseBodyRef.current = note.body;
          }
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

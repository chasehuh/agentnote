import type { Note } from "./types";

export const AGENTNOTE_SYNC_CHANNEL = "agentnote.sync";

export type SyncMessage =
  | {
      type: "draft";
      sourceId: string;
      id: string;
      body: string;
      title: string;
      at: number;
      /**
       * Server generation (`updated_at`) the drafting tab's BUFFER is based
       * on — `baseUpdatedAtRef`, never the poll-refreshed list row, which can
       * advance past a stale dirty buffer and launder its drafts as current.
       * Receivers reject editor apply when this does not match local.
       */
      baseUpdatedAt?: string;
      /**
       * Fingerprint of the server body at `baseUpdatedAt` (bodyFingerprint).
       * Receivers reject editor apply unless it matches their own base body,
       * failing closed when absent (old bundles).
       */
      baseFingerprint?: string;
      /** Monotonic per-tab draft sequence for out-of-order ignore. */
      draftSeq?: number;
    }
  | {
      type: "upsert";
      sourceId: string;
      note: Note;
    }
  | {
      /** Leave the main Notes list (soft-archive or permanent). */
      type: "delete";
      sourceId: string;
      id: string;
    }
  | {
      type: "archive";
      sourceId: string;
      note: Note;
    }
  | {
      type: "restore";
      sourceId: string;
      note: Note;
    }
  | {
      /**
       * Manual sidebar order changed. Carries only the ranks, never bodies: a
       * reorder leaves `updated_at` untouched, so the usual newer-wins upsert
       * would drop it on the floor.
       */
      type: "reorder";
      sourceId: string;
      order: Pick<Note, "id" | "sort_order">[];
    }
  | {
      /**
       * Binary Yjs update for a CRDT-backed note, mirrored to peer tabs
       * instantly. Structured clone handles `Uint8Array` natively. No sequence
       * number: duplicate and out-of-order delivery are correct CRDT inputs.
       */
      type: "doc-update";
      sourceId: string;
      id: string;
      update: Uint8Array;
    };

export function createTabId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function syncChannelName(userId?: string | null) {
  if (userId) return `${AGENTNOTE_SYNC_CHANNEL}.${userId}`;
  return AGENTNOTE_SYNC_CHANNEL;
}

export function openSyncChannel(
  onMessage: (message: SyncMessage) => void,
  userId?: string | null,
) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return {
      post: (_message: SyncMessage) => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(syncChannelName(userId));
  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    if (!event.data || typeof event.data !== "object") return;
    onMessage(event.data);
  };

  return {
    post(message: SyncMessage) {
      try {
        channel.postMessage(message);
      } catch {
        // Ignore structured-clone failures; server poll remains fallback.
      }
    },
    close() {
      channel.close();
    },
  };
}

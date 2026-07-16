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

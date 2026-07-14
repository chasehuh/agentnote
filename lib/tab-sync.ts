import type { Note } from "./types";

export const MEMO_SYNC_CHANNEL = "memo.sync";

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
      type: "delete";
      sourceId: string;
      id: string;
    };

export function createTabId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function openSyncChannel(onMessage: (message: SyncMessage) => void) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return {
      post: (_message: SyncMessage) => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(MEMO_SYNC_CHANNEL);
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

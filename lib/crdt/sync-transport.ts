import { base64ToBytes, bytesToBase64 } from "./note-doc";

/**
 * HTTP transport for the note CRDT. Phase 2 swaps a WebSocket provider in
 * behind these two calls without touching the hook.
 */

export type NoteDocStateResponse = {
  update: Uint8Array;
  seq: number;
};

export type NoteDocSyncResponse = {
  seq: number;
  update: Uint8Array | null;
  body: string;
  updatedAt: string;
};

export async function fetchNoteDocState(
  noteId: string,
  opts?: { signal?: AbortSignal },
): Promise<NoteDocStateResponse> {
  const response = await fetch(`/api/notes/${noteId}/doc`, {
    cache: "no-store",
    signal: opts?.signal,
  });
  if (!response.ok) {
    throw new Error(`doc load failed: ${response.status}`);
  }
  const data = (await response.json()) as { update: string; seq: number };
  return { update: base64ToBytes(data.update), seq: data.seq };
}

export async function pushNoteDocSync(
  noteId: string,
  input: {
    update?: Uint8Array | null;
    stateVector?: Uint8Array | null;
    since?: number | null;
  },
  opts?: { keepalive?: boolean; signal?: AbortSignal },
): Promise<NoteDocSyncResponse> {
  const response = await fetch(`/api/notes/${noteId}/doc/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `keepalive` lets a pagehide/unload flush outlive the document.
    keepalive: opts?.keepalive,
    signal: opts?.signal,
    body: JSON.stringify({
      update: input.update ? bytesToBase64(input.update) : undefined,
      state_vector: input.stateVector
        ? bytesToBase64(input.stateVector)
        : undefined,
      since: input.since ?? undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`doc sync failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    seq: number;
    update: string | null;
    body: string;
    updated_at: string;
  };
  return {
    seq: data.seq,
    update: data.update ? base64ToBytes(data.update) : null,
    body: data.body,
    updatedAt: data.updated_at,
  };
}

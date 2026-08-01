import { verifyToken } from "@clerk/backend";
import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import {
  getNoteDocState,
  persistNoteDocState,
  readNoteOwnerId,
  resolveOwnedNoteId,
} from "../../../lib/crdt/note-doc-store";
import { readCollabEnv } from "./env";
import { authorizeNoteRoom } from "./room-auth";

/**
 * agentnote realtime server.
 *
 * One Hocuspocus room per note, keyed by the note's canonical id. Persistence
 * reuses the same snapshot + update-log helpers the HTTP transport writes to,
 * so there is exactly one document history — a second one would surface as
 * duplicated body text.
 */

type CollabContext = { userId: string };

const env = readCollabEnv();

/** Store at most this often while a room is active. */
const STORE_DEBOUNCE_MS = 2_000;
/** …and at least this often, however busy the room is. */
const STORE_MAX_DEBOUNCE_MS = 10_000;

const server = new Server<CollabContext>({
  name: "agentnote-collab",
  port: env.port,
  address: "0.0.0.0",
  quiet: true,
  debounce: STORE_DEBOUNCE_MS,
  maxDebounce: STORE_MAX_DEBOUNCE_MS,

  async onAuthenticate({ token, documentName, requestHeaders }) {
    const result = await authorizeNoteRoom({
      token,
      documentName,
      origin: requestHeaders.get("origin"),
      allowedOrigins: env.allowedOrigins,
      verifyToken: (value) =>
        verifyToken(value, { secretKey: env.clerkSecretKey }),
      resolveOwnedNoteId,
    });

    if (result.status !== "ok") {
      // Never say which of "does not exist" / "not yours" it was.
      console.warn("collab auth rejected", {
        documentName,
        status: result.status,
        reason: result.reason,
      });
      throw new Error("Unauthorized");
    }

    return { userId: result.userId };
  },

  extensions: [
    new Database({
      /** First load of a room: snapshot + tail, seeding from `notes.body` once. */
      async fetch({ documentName, context }) {
        const { userId } = context as CollabContext;
        const state = await getNoteDocState(userId, documentName);
        // Returning null lets Hocuspocus start an empty document. That is only
        // correct when the note genuinely has no state to restore.
        return state ? state.update : null;
      },

      /** Debounced write-back: merge, snapshot, fold the tail, re-project. */
      async store({ documentName, state }) {
        // Write as the note's owner rather than the last connection's context:
        // the room key was already authorized at connect time, and a stale
        // context would silently skip the write.
        const userId = await readNoteOwnerId(documentName);
        if (!userId) {
          console.error("collab store skipped: no owner", { documentName });
          return;
        }
        const result = await persistNoteDocState({
          userId,
          noteId: documentName,
          state: new Uint8Array(state),
        });
        if (!result) {
          console.error("collab store skipped", { documentName });
        }
      },
    }),
  ],

  async onRequest({ request, response }) {
    if (request.url === "/health" || request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "agentnote-collab" }));
      // Rejecting with no error tells Hocuspocus the response is already sent.
      return Promise.reject();
    }
    return Promise.resolve();
  },
});

server
  .listen()
  .then(() => {
    console.log(`agentnote-collab listening on :${env.port}`);
  })
  .catch((error) => {
    console.error("agentnote-collab failed to start", error);
    process.exit(1);
  });

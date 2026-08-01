import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NOTE_TEXT_KEY, seedDocFromPlaintext } from "./note-doc";
import { NETWORK_ORIGIN } from "./transport";
import { bridgeDocuments } from "./websocket-transport";

/**
 * The realtime provider owns a separate document so inbound updates can pass
 * through the IME gate before CodeMirror sees them. These cover the bridge that
 * makes that split safe.
 */

type Harness = {
  editor: Y.Doc;
  network: Y.Doc;
  /** Updates the gate would have deferred, in arrival order. */
  gated: { update: Uint8Array; origin: string }[];
  /** Apply everything the gate is holding, as `compositionend` does. */
  release: () => void;
  dispose: () => void;
};

function harness(opts?: { hold?: boolean; seed?: string }): Harness {
  const editor = new Y.Doc();
  const network = new Y.Doc();
  if (opts?.seed) {
    Y.applyUpdate(editor, seedDocFromPlaintext(opts.seed));
  }

  const gated: { update: Uint8Array; origin: string }[] = [];
  let holding = Boolean(opts?.hold);

  const applyRemote = (update: Uint8Array, origin: string) => {
    if (holding) {
      gated.push({ update, origin });
      return;
    }
    Y.applyUpdate(editor, update, origin);
  };

  const unbridge = bridgeDocuments({ editor, network, applyRemote });

  return {
    editor,
    network,
    gated,
    release() {
      holding = false;
      for (const item of gated.splice(0)) {
        Y.applyUpdate(editor, item.update, item.origin);
      }
    },
    dispose() {
      unbridge();
      editor.destroy();
      network.destroy();
    },
  };
}

const text = (doc: Y.Doc) => doc.getText(NOTE_TEXT_KEY).toString();

describe("bridgeDocuments", () => {
  it("seeds the network document from what the editor already holds", () => {
    // IndexedDB restored offline work before the socket came up.
    const h = harness({ seed: "restored offline" });
    expect(text(h.network)).toBe("restored offline");
    h.dispose();
  });

  it("carries local edits to the network document", () => {
    const h = harness({ seed: "base" });
    h.editor.getText(NOTE_TEXT_KEY).insert(4, " typed");
    expect(text(h.network)).toBe("base typed");
    h.dispose();
  });

  it("carries peer-tab updates to the network document", () => {
    // A BroadcastChannel peer may be the only one holding that edit.
    const h = harness({ seed: "base" });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.editor));
    peer.getText(NOTE_TEXT_KEY).insert(0, "peer ");
    Y.applyUpdate(h.editor, Y.encodeStateAsUpdate(peer), "broadcast");

    expect(text(h.network)).toBe("peer base");
    h.dispose();
  });

  it("routes inbound updates through the gate, not straight into the editor", () => {
    const h = harness({ seed: "base", hold: true });
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));
    server.getText(NOTE_TEXT_KEY).insert(0, "remote ");
    Y.applyUpdate(h.network, Y.encodeStateAsUpdate(server));

    // Composition in flight: the editor must not have moved yet.
    expect(h.gated).toHaveLength(1);
    expect(h.gated[0].origin).toBe(NETWORK_ORIGIN);
    expect(text(h.editor)).toBe("base");

    h.release();
    expect(text(h.editor)).toBe("remote base");
    h.dispose();
  });

  it("does not echo an inbound update back to the network", () => {
    const h = harness({ seed: "base" });
    const seen: Uint8Array[] = [];
    h.network.on("update", (update: Uint8Array) => seen.push(update));

    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));
    server.getText(NOTE_TEXT_KEY).insert(0, "remote ");
    Y.applyUpdate(h.network, Y.encodeStateAsUpdate(server));

    // One update in (the server's); nothing bounced back out.
    expect(seen).toHaveLength(1);
    expect(text(h.editor)).toBe("remote base");
    expect(text(h.network)).toBe("remote base");
    h.dispose();
  });

  it("converges when both sides edit at once", () => {
    const h = harness({ seed: "note\n" });
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));

    h.editor.getText(NOTE_TEXT_KEY).insert(0, "local\n");
    server.getText(NOTE_TEXT_KEY).insert(
      server.getText(NOTE_TEXT_KEY).length,
      "remote\n",
    );

    Y.applyUpdate(h.network, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));

    expect(text(h.editor)).toBe(text(h.network));
    expect(text(h.network)).toBe(text(server));
    expect(text(h.editor)).toContain("local");
    expect(text(h.editor)).toContain("remote");
    h.dispose();
  });

  it("converges even when the gate releases late", () => {
    // Deferring for an IME composition must not change the outcome.
    const h = harness({ seed: "start\n", hold: true });
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));
    server.getText(NOTE_TEXT_KEY).insert(0, "peer\n");
    Y.applyUpdate(h.network, Y.encodeStateAsUpdate(server));

    // The user finishes composing while the remote edit waits.
    h.editor.getText(NOTE_TEXT_KEY).insert(
      h.editor.getText(NOTE_TEXT_KEY).length,
      "한글\n",
    );
    h.release();

    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.network));
    expect(text(h.editor)).toBe(text(server));
    expect(text(h.editor)).toContain("한글");
    expect(text(h.editor)).toContain("peer");
    h.dispose();
  });

  it("stops mirroring once disposed", () => {
    const h = harness({ seed: "base" });
    h.dispose();

    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, seedDocFromPlaintext("base"));
    expect(() => fresh.getText(NOTE_TEXT_KEY).insert(0, "x")).not.toThrow();
  });
});

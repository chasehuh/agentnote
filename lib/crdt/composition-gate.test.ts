import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createCompositionGate } from "./composition-gate";
import { NOTE_TEXT_KEY, seedDocFromPlaintext } from "./note-doc";

describe("createCompositionGate", () => {
  it("applies immediately when nothing is composing", () => {
    const applied: number[] = [];
    const gate = createCompositionGate<number>((n) => applied.push(n));
    gate.push(1);
    gate.push(2);
    expect(applied).toEqual([1, 2]);
    expect(gate.composing).toBe(false);
  });

  it("holds updates during a composition and replays them in order", () => {
    const applied: number[] = [];
    const gate = createCompositionGate<number>((n) => applied.push(n));

    gate.start();
    gate.push(1);
    gate.push(2);
    expect(applied).toEqual([]);
    expect(gate.composing).toBe(true);

    gate.end();
    expect(applied).toEqual([1, 2]);
    expect(gate.composing).toBe(false);
  });

  it("does not replay the same batch twice", () => {
    const applied: number[] = [];
    const gate = createCompositionGate<number>((n) => applied.push(n));
    gate.start();
    gate.push(1);
    gate.end();
    gate.end();
    expect(applied).toEqual([1]);
  });

  it("converges to the same document as immediate application", () => {
    // Deferring is only safe because Yjs updates are commutative — assert it.
    const seed = seedDocFromPlaintext("base");

    const peer = new Y.Doc();
    Y.applyUpdate(peer, seed);
    const before = Y.encodeStateVector(peer);
    peer.getText(NOTE_TEXT_KEY).insert(0, "peer ");
    const remote = Y.encodeStateAsUpdate(peer, before);

    const deferredDoc = new Y.Doc();
    Y.applyUpdate(deferredDoc, seed);
    const gate = createCompositionGate<Uint8Array>((update) =>
      Y.applyUpdate(deferredDoc, update, "remote"),
    );

    gate.start();
    gate.push(remote);
    // The user finishes a Hangul composition while the remote update waits.
    deferredDoc.getText(NOTE_TEXT_KEY).insert(4, " 한글");
    expect(deferredDoc.getText(NOTE_TEXT_KEY).toString()).toBe("base 한글");
    gate.end();

    const immediateDoc = new Y.Doc();
    Y.applyUpdate(immediateDoc, seed);
    Y.applyUpdate(immediateDoc, remote, "remote");
    immediateDoc.getText(NOTE_TEXT_KEY).insert(9, " 한글");

    expect(deferredDoc.getText(NOTE_TEXT_KEY).toString()).toBe("peer base 한글");
    expect(immediateDoc.getText(NOTE_TEXT_KEY).toString()).toBe(
      "peer base 한글",
    );
  });
});

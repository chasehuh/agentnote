import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NOTE_TEXT_KEY, seedDocFromPlaintext } from "./note-doc";

/**
 * The load-bearing tests: every scenario that cost a body under the legacy
 * whole-document path (#51, #53, #57) must merge here instead of discarding.
 */

function openFrom(seed: Uint8Array): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed);
  return { doc, text: doc.getText(NOTE_TEXT_KEY) };
}

function exchange(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

function body(doc: Y.Doc) {
  return doc.getText(NOTE_TEXT_KEY).toString();
}

describe("two tabs editing different regions", () => {
  it("keeps both edits — under PUT one side is truncated", () => {
    const seed = seedDocFromPlaintext("shared note body");
    const a = openFrom(seed);
    const b = openFrom(seed);

    a.text.insert(0, "PREFIX ");
    b.text.insert(b.text.length, "\nAPPENDED");

    exchange(a.doc, b.doc);

    expect(body(a.doc)).toBe(body(b.doc));
    expect(body(a.doc)).toContain("PREFIX");
    expect(body(a.doc)).toContain("APPENDED");
    expect(body(a.doc)).toContain("shared note body");
  });
});

describe("the #57 stale-tab scenario", () => {
  it("merges a tab that has been 50 updates behind", () => {
    const seed = seedDocFromPlaintext("original body\n");
    const stale = openFrom(seed);
    const active = openFrom(seed);

    // Active tab types while the stale tab is backgrounded (poll paused).
    for (let i = 0; i < 50; i += 1) {
      active.text.insert(active.text.length, `line ${i}\n`);
    }

    // Stale tab returns and immediately types at the top with its old buffer.
    stale.text.insert(0, "typed in the stale tab\n");

    exchange(stale.doc, active.doc);

    expect(body(stale.doc)).toBe(body(active.doc));
    expect(body(stale.doc)).toContain("typed in the stale tab");
    expect(body(stale.doc)).toContain("line 49");
    expect(body(stale.doc)).toContain("original body");
  });
});

describe("two devices dirty at the same time", () => {
  it("converges to one document after a single sync round", () => {
    const seed = seedDocFromPlaintext("meeting notes\n");
    const laptop = openFrom(seed);
    const phone = openFrom(seed);

    laptop.text.insert(laptop.text.length, "- from the laptop\n");
    phone.text.insert(phone.text.length, "- from the phone\n");

    exchange(laptop.doc, phone.doc);

    expect(body(laptop.doc)).toBe(body(phone.doc));
    expect(body(laptop.doc)).toContain("from the laptop");
    expect(body(laptop.doc)).toContain("from the phone");
  });
});

describe("delivery order", () => {
  it("converges under out-of-order and duplicate updates", () => {
    // Asserts the `draftSeq` / `isDraftBaseCurrent` machinery is unnecessary
    // here: both are correct inputs to a CRDT.
    const seed = seedDocFromPlaintext("base\n");
    const author = openFrom(seed);

    const updates: Uint8Array[] = [];
    author.doc.on("update", (update: Uint8Array) => updates.push(update));
    author.text.insert(author.text.length, "one\n");
    author.text.insert(author.text.length, "two\n");
    author.text.insert(author.text.length, "three\n");
    expect(updates).toHaveLength(3);

    const peer = openFrom(seed);
    const shuffled = [
      updates[2],
      updates[0],
      updates[2],
      updates[1],
      updates[0],
    ];
    for (const update of shuffled) {
      Y.applyUpdate(peer.doc, update);
    }

    expect(body(peer.doc)).toBe(body(author.doc));
    expect(body(peer.doc)).toBe("base\none\ntwo\nthree\n");
  });
});

describe("concurrent edits at the same offset", () => {
  it("keeps both insertions deterministically", () => {
    const seed = seedDocFromPlaintext("AB");
    const a = openFrom(seed);
    const b = openFrom(seed);

    a.text.insert(1, "left");
    b.text.insert(1, "right");

    exchange(a.doc, b.doc);

    expect(body(a.doc)).toBe(body(b.doc));
    expect(body(a.doc)).toContain("left");
    expect(body(a.doc)).toContain("right");
  });
});

describe("delete versus edit", () => {
  it("does not resurrect deleted text or lose the concurrent insert", () => {
    const seed = seedDocFromPlaintext("keep DROP keep");
    const a = openFrom(seed);
    const b = openFrom(seed);

    a.text.delete(5, 5); // remove "DROP "
    b.text.insert(b.text.length, " tail");

    exchange(a.doc, b.doc);

    expect(body(a.doc)).toBe(body(b.doc));
    expect(body(a.doc)).toBe("keep keep tail");
  });
});

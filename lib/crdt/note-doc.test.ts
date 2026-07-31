import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { substituteAsciiArrows } from "../arrows";
import {
  MAX_DOC_UPDATE_BASE64_CHARS,
  MAX_DOC_UPDATE_BYTES,
  NOTE_TEXT_KEY,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  docBodyFromState,
  docFromUpdates,
  encodeMissingUpdate,
  mergeUpdatesToState,
  seedDocFromPlaintext,
} from "./note-doc";

function roundTrip(body: string): string {
  return docBodyFromState(seedDocFromPlaintext(body));
}

describe("seedDocFromPlaintext", () => {
  it("round-trips plain markdown", () => {
    const body = "# 0731.md\n\n- one\n- two\n";
    expect(roundTrip(body)).toBe(body);
  });

  it("round-trips an empty body", () => {
    expect(roundTrip("")).toBe("");
  });

  it("round-trips CRLF without normalising line endings", () => {
    const body = "first\r\nsecond\r\n";
    expect(roundTrip(body)).toBe(body);
  });

  it("round-trips emoji and other surrogate pairs", () => {
    // The apply-external minimal-diff path has to snap off surrogate interiors;
    // a CRDT must simply preserve them.
    const body = "🙂 shipped 👨‍👩‍👧‍👦 done\n";
    expect(roundTrip(body)).toBe(body);
  });

  it("round-trips Hangul", () => {
    const body = "한글 입력 테스트\n두 번째 줄";
    expect(roundTrip(body)).toBe(body);
  });

  it("round-trips substituted unicode arrows", () => {
    const { text } = substituteAsciiArrows("a -> b -> c");
    expect(text).toContain("→");
    expect(roundTrip(text)).toBe(text);
  });
});

describe("base64 codec", () => {
  it("round-trips arbitrary binary", () => {
    const bytes = new Uint8Array(512);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
    expect(bytesEqual(base64ToBytes(bytesToBase64(bytes)), bytes)).toBe(true);
  });

  it("round-trips a real document state", () => {
    const state = seedDocFromPlaintext("body\nwith lines");
    expect(docBodyFromState(base64ToBytes(bytesToBase64(state)))).toBe(
      "body\nwith lines",
    );
  });

  it("throws on malformed base64 so routes can answer 400", () => {
    expect(() => base64ToBytes("not base64!!")).toThrow();
  });

  it("bounds the encoded payload above the decoded cap", () => {
    expect(MAX_DOC_UPDATE_BASE64_CHARS).toBeGreaterThan(MAX_DOC_UPDATE_BYTES);
  });
});

describe("mergeUpdatesToState", () => {
  it("folds a seed plus incremental updates into one state", () => {
    const seed = seedDocFromPlaintext("start");
    const doc = docFromUpdates([seed]);
    const before = Y.encodeStateVector(doc);
    doc.getText(NOTE_TEXT_KEY).insert(5, " more");
    const increment = Y.encodeStateAsUpdate(doc, before);

    const { state } = mergeUpdatesToState([seed, increment]);
    expect(docBodyFromState(state)).toBe("start more");
  });

  it("is order-independent and idempotent", () => {
    const seed = seedDocFromPlaintext("base");
    const doc = docFromUpdates([seed]);
    const before = Y.encodeStateVector(doc);
    doc.getText(NOTE_TEXT_KEY).insert(4, "!");
    const increment = Y.encodeStateAsUpdate(doc, before);

    const forward = mergeUpdatesToState([seed, increment]);
    const reversed = mergeUpdatesToState([increment, seed]);
    const duplicated = mergeUpdatesToState([seed, increment, increment, seed]);

    expect(docBodyFromState(forward.state)).toBe("base!");
    expect(docBodyFromState(reversed.state)).toBe("base!");
    expect(docBodyFromState(duplicated.state)).toBe("base!");
  });
});

describe("encodeMissingUpdate", () => {
  it("returns null when the caller asked for nothing", () => {
    const doc = docFromUpdates([seedDocFromPlaintext("x")]);
    expect(encodeMissingUpdate(doc, null)).toBeNull();
  });

  it("returns null when the caller is already current", () => {
    const doc = docFromUpdates([seedDocFromPlaintext("x")]);
    expect(encodeMissingUpdate(doc, Y.encodeStateVector(doc))).toBeNull();
  });

  it("returns only what the caller is missing", () => {
    const doc = docFromUpdates([seedDocFromPlaintext("x")]);
    const clientVector = Y.encodeStateVector(doc);
    doc.getText(NOTE_TEXT_KEY).insert(1, "yz");

    const diff = encodeMissingUpdate(doc, clientVector);
    expect(diff).not.toBeNull();

    const client = docFromUpdates([seedDocFromPlaintext("x")]);
    // The diff alone must be enough to catch a client up.
    expect(() => Y.applyUpdate(client, diff as Uint8Array)).not.toThrow();
  });
});

describe("seeding twice", () => {
  it("duplicates the body — which is why seeding is server-only and guarded", () => {
    const first = seedDocFromPlaintext("note body");
    const second = seedDocFromPlaintext("note body");
    const merged = mergeUpdatesToState([first, second]);
    expect(docBodyFromState(merged.state)).not.toBe("note body");
    expect(docBodyFromState(merged.state)).toHaveLength("note body".length * 2);
  });
});

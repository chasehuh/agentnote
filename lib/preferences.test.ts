import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  isWrapPreference,
  noteIndexForShortcut,
  parseCollapsedIds,
  parseDigitShortcuts,
  parseSidebarWidth,
} from "./preferences";

describe("isWrapPreference", () => {
  it("reads the persisted booleans and rejects anything else", () => {
    expect(isWrapPreference("true")).toBe(true);
    expect(isWrapPreference("false")).toBe(false);
    expect(isWrapPreference(null)).toBeNull();
    expect(isWrapPreference("yes")).toBeNull();
  });
});

describe("parseCollapsedIds", () => {
  it("round-trips a persisted id list", () => {
    expect(parseCollapsedIds(JSON.stringify(["abc-defg-hij"]))).toEqual([
      "abc-defg-hij",
    ]);
  });

  it("reads nothing-collapsed for an unset key", () => {
    expect(parseCollapsedIds(null)).toEqual([]);
    expect(parseCollapsedIds("")).toEqual([]);
  });

  // Failing open matters here: a malformed value that threw, or that produced
  // junk ids, would collapse rows the user never collapsed and hide notes.
  it("falls back to nothing-collapsed on malformed JSON", () => {
    expect(parseCollapsedIds("{not json")).toEqual([]);
  });

  it("ignores a non-array payload", () => {
    expect(parseCollapsedIds('{"a":1}')).toEqual([]);
    expect(parseCollapsedIds('"abc"')).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(parseCollapsedIds('["ok", 5, null, {"x":1}]')).toEqual(["ok"]);
  });
});

describe("clampSidebarWidth", () => {
  it("passes an in-range width through, rounded to whole pixels", () => {
    expect(clampSidebarWidth(320, 1600)).toBe(320);
    expect(clampSidebarWidth(320.4, 1600)).toBe(320);
  });

  it("holds the min and max bounds", () => {
    expect(clampSidebarWidth(10, 1600)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9000, 4000)).toBe(MAX_SIDEBAR_WIDTH);
  });

  // The 45vw cap is what keeps the panel from swallowing a small window; it
  // binds before the absolute 480 cap whenever the window is under ~1067px.
  it("caps at 45vw on a narrow window", () => {
    expect(clampSidebarWidth(9000, 800)).toBe(360);
    expect(clampSidebarWidth(9000, 1600)).toBe(MAX_SIDEBAR_WIDTH);
  });

  // A window under 400px cannot satisfy both bounds. The floor wins: a 0-width
  // panel must only ever come from `data-open="false"`.
  it("keeps the min floor when 45vw would fall below it", () => {
    expect(clampSidebarWidth(300, 320)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("ignores a missing or nonsense viewport width", () => {
    expect(clampSidebarWidth(9000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9000, 0)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.NaN, 1600)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("parseSidebarWidth", () => {
  it("restores a persisted width", () => {
    expect(parseSidebarWidth("312", 1600)).toBe(312);
  });

  it("falls back to the default when unset or malformed", () => {
    expect(parseSidebarWidth(null, 1600)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("", 1600)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("wide", 1600)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  // A width persisted on a big monitor must not survive onto a small one.
  it("re-clamps a stored width against the current viewport", () => {
    expect(parseSidebarWidth("470", 800)).toBe(360);
  });
});

describe("parseDigitShortcuts", () => {
  it("round-trips the persisted booleans", () => {
    expect(parseDigitShortcuts("true")).toBe(true);
    expect(parseDigitShortcuts("false")).toBe(false);
  });

  // Failing off matters here: claiming ⌘1…⌘9 from the browser on the strength
  // of a junk storage value would break tab switching for a user who never
  // asked for the chords.
  it("defaults to off for an unset or malformed value", () => {
    expect(parseDigitShortcuts(null)).toBe(false);
    expect(parseDigitShortcuts("")).toBe(false);
    expect(parseDigitShortcuts("yes")).toBe(false);
    expect(parseDigitShortcuts("1")).toBe(false);
    expect(parseDigitShortcuts("TRUE")).toBe(false);
  });
});

describe("noteIndexForShortcut", () => {
  const chord = (over: Partial<Parameters<typeof noteIndexForShortcut>[0]>) => ({
    key: "",
    code: "",
    shiftKey: false,
    altKey: false,
    ...over,
  });

  it("maps digit N to the (N-1)th row", () => {
    expect(noteIndexForShortcut(chord({ key: "1", code: "Digit1" }))).toBe(0);
    expect(noteIndexForShortcut(chord({ key: "2", code: "Digit2" }))).toBe(1);
    expect(noteIndexForShortcut(chord({ key: "9", code: "Digit9" }))).toBe(8);
  });

  // Non-US layouts can report a symbol in `key` while `code` stays physical.
  it("matches on the physical code and the numpad", () => {
    expect(noteIndexForShortcut(chord({ key: "&", code: "Digit1" }))).toBe(0);
    expect(noteIndexForShortcut(chord({ key: "é", code: "Digit2" }))).toBe(1);
    expect(noteIndexForShortcut(chord({ key: "3", code: "Numpad3" }))).toBe(2);
  });

  // ⌘0 is left to the host: there is no 0th row, and no wrap to the last one.
  it("leaves 0 unbound", () => {
    expect(noteIndexForShortcut(chord({ key: "0", code: "Digit0" }))).toBeNull();
    expect(
      noteIndexForShortcut(chord({ key: ")", code: "Numpad0" })),
    ).toBeNull();
  });

  it("ignores non-digit keys", () => {
    expect(noteIndexForShortcut(chord({ key: "n", code: "KeyN" }))).toBeNull();
    expect(
      noteIndexForShortcut(chord({ key: "Enter", code: "Enter" })),
    ).toBeNull();
    expect(noteIndexForShortcut(chord({ key: "", code: "" }))).toBeNull();
  });

  it("does not match when Shift or Alt is held", () => {
    expect(
      noteIndexForShortcut(chord({ key: "1", code: "Digit1", shiftKey: true })),
    ).toBeNull();
    expect(
      noteIndexForShortcut(chord({ key: "1", code: "Digit1", altKey: true })),
    ).toBeNull();
  });
});

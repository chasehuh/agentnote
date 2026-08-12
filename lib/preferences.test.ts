import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  isWrapPreference,
  parseCollapsedIds,
  parseSidebarWidth,
  sidebarSegmentForShortcut,
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

describe("sidebarSegmentForShortcut", () => {
  const chord = (over: Partial<Parameters<typeof sidebarSegmentForShortcut>[0]>) => ({
    key: "",
    code: "",
    shiftKey: false,
    altKey: false,
    ...over,
  });

  it("maps 1 to Notes and 2 to Archived", () => {
    expect(sidebarSegmentForShortcut(chord({ key: "1", code: "Digit1" }))).toBe(
      "notes",
    );
    expect(sidebarSegmentForShortcut(chord({ key: "2", code: "Digit2" }))).toBe(
      "archived",
    );
  });

  // Non-US layouts can report a symbol in `key` while `code` stays physical.
  it("matches on the physical code and the numpad", () => {
    expect(sidebarSegmentForShortcut(chord({ key: "&", code: "Digit1" }))).toBe(
      "notes",
    );
    expect(sidebarSegmentForShortcut(chord({ key: "2", code: "Numpad2" }))).toBe(
      "archived",
    );
  });

  it("ignores other digits and non-digit keys", () => {
    expect(
      sidebarSegmentForShortcut(chord({ key: "3", code: "Digit3" })),
    ).toBeNull();
    expect(
      sidebarSegmentForShortcut(chord({ key: "n", code: "KeyN" })),
    ).toBeNull();
  });

  it("does not match when Shift or Alt is held", () => {
    expect(
      sidebarSegmentForShortcut(chord({ key: "1", code: "Digit1", shiftKey: true })),
    ).toBeNull();
    expect(
      sidebarSegmentForShortcut(chord({ key: "1", code: "Digit1", altKey: true })),
    ).toBeNull();
  });
});

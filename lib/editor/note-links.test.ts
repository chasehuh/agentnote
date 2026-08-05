/** @vitest-environment jsdom */
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterCandidates,
  hasExactTitle,
  noteLinkMarkdown,
  noteLinkSource,
  slashCommandSource,
  type NoteLinkCandidate,
} from "./note-links";

const NOTES: NoteLinkCandidate[] = [
  { id: "abc-mnop-xyz", title: "Deploy checklist" },
  { id: "def-qrst-uvw", title: "Weekly review" },
  { id: "ghi-jklm-nop", title: "" },
];

function options(overrides?: {
  createNote?: (title: string) => Promise<NoteLinkCandidate | null>;
}) {
  return {
    candidates: () => NOTES,
    createNote:
      overrides?.createNote ??
      (async (title: string) => ({ id: "new-note-idz", title })),
  };
}

/** Run a completion source against a doc with the caret at the end. */
function complete(
  source: ReturnType<typeof noteLinkSource>,
  doc: string,
  explicit = false,
) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
  });
  return source(new CompletionContext(state, doc.length, explicit));
}

let view: EditorView | null = null;

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("noteLinkMarkdown", () => {
  it("emits a plain markdown deep link", () => {
    expect(noteLinkMarkdown(NOTES[0])).toBe(
      "[Deploy checklist](/n/abc-mnop-xyz)",
    );
  });

  it("falls back to Untitled for an empty title", () => {
    expect(noteLinkMarkdown(NOTES[2])).toBe("[Untitled](/n/ghi-jklm-nop)");
  });

  it("strips brackets that would break the label", () => {
    expect(noteLinkMarkdown({ id: "x", title: "a [b] c" })).toBe(
      "[a b c](/n/x)",
    );
  });
});

describe("filterCandidates / hasExactTitle", () => {
  it("matches case-insensitive substrings", () => {
    expect(filterCandidates(NOTES, "deploy").map((n) => n.id)).toEqual([
      "abc-mnop-xyz",
    ]);
    expect(filterCandidates(NOTES, "REVIEW").map((n) => n.id)).toEqual([
      "def-qrst-uvw",
    ]);
  });

  it("returns everything for an empty query", () => {
    expect(filterCandidates(NOTES, "  ")).toHaveLength(3);
  });

  it("detects an exact title so Create is not offered twice", () => {
    expect(hasExactTitle(NOTES, "Deploy checklist")).toBe(true);
    expect(hasExactTitle(NOTES, "deploy CHECKLIST")).toBe(true);
    expect(hasExactTitle(NOTES, "Deploy")).toBe(false);
  });
});

describe("noteLinkSource", () => {
  it("does not fire without the [[ trigger", () => {
    expect(complete(noteLinkSource(options()), "just prose")).toBeNull();
    expect(complete(noteLinkSource(options()), "[single")).toBeNull();
  });

  it("stays closed on a bare [[ until something is typed", () => {
    expect(complete(noteLinkSource(options()), "[[")).toBeNull();
    // …but an explicit request (Ctrl-Space) opens the full list.
    const explicit = complete(noteLinkSource(options()), "[[", true);
    expect(explicit?.options).toHaveLength(3);
  });

  it("offers matching notes and a Create option", () => {
    const result = complete(noteLinkSource(options()), "see [[deploy");
    expect(result?.options.map((o) => o.label)).toEqual([
      "Deploy checklist",
      'Create "deploy"',
    ]);
    // Replaces the whole `[[deploy` trigger, not just the query.
    expect(result?.from).toBe(4);
  });

  it("puts Create first when nothing matched", () => {
    const result = complete(noteLinkSource(options()), "[[brand new");
    expect(result?.options.map((o) => o.label)).toEqual(['Create "brand new"']);
  });

  it("omits Create when the query exactly names a note", () => {
    const result = complete(noteLinkSource(options()), "[[Deploy checklist");
    expect(result?.options.map((o) => o.label)).toEqual(["Deploy checklist"]);
  });

  it("does not reopen across a closed link", () => {
    expect(
      complete(noteLinkSource(options()), "[[Deploy checklist]] then more"),
    ).toBeNull();
  });

  it("inserts markdown for a picked note, replacing the trigger", () => {
    const v = mount("see [[deploy");
    const result = complete(noteLinkSource(options()), "see [[deploy");
    result?.options[0].apply?.(v, result.options[0], 4, 12);
    expect(v.state.doc.toString()).toBe("see [Deploy checklist](/n/abc-mnop-xyz)");
    expect(v.state.selection.main.head).toBe(v.state.doc.length);
  });

  // The create/link split is what makes hierarchy correct (#80): only
  // create-from-inside nests, so picking an existing note must never reach
  // `createNote` — that is the call the app hangs `parent_id` off.
  it("never calls createNote when an existing note is picked", () => {
    const createNote = vi.fn(async (title: string) => ({
      id: "new-note-idz",
      title,
    }));
    const v = mount("see [[deploy");
    const result = complete(
      noteLinkSource(options({ createNote })),
      "see [[deploy",
    );
    result?.options[0].apply?.(v, result.options[0], 4, 12);

    expect(v.state.doc.toString()).toBe("see [Deploy checklist](/n/abc-mnop-xyz)");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("creates a note then inserts its link at the caret", async () => {
    const createNote = vi.fn(async (title: string) => ({
      id: "new-note-idz",
      title,
    }));
    const v = mount("see [[brand new");
    const result = complete(
      noteLinkSource(options({ createNote })),
      "see [[brand new",
    );
    result?.options[0].apply?.(v, result.options[0], 4, 15);

    // Trigger text is removed synchronously, before the round trip.
    expect(v.state.doc.toString()).toBe("see ");
    await vi.waitFor(() => {
      expect(v!.state.doc.toString()).toBe("see [brand new](/n/new-note-idz)");
    });
    expect(createNote).toHaveBeenCalledWith("brand new");
  });

  it("leaves the buffer clean when creation fails", async () => {
    const createNote = vi.fn(async () => null);
    const v = mount("see [[brand new");
    const result = complete(
      noteLinkSource(options({ createNote })),
      "see [[brand new",
    );
    result?.options[0].apply?.(v, result.options[0], 4, 15);
    await vi.waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(v.state.doc.toString()).toBe("see ");
  });
});

describe("slashCommandSource", () => {
  it("fires at the start of a line and after whitespace", () => {
    expect(complete(slashCommandSource(options()), "/")?.options).toHaveLength(
      2,
    );
    expect(
      complete(slashCommandSource(options()), "text /")?.options,
    ).toHaveLength(2);
  });

  it("does not fire inside a path", () => {
    expect(complete(slashCommandSource(options()), "a/b")).toBeNull();
    expect(complete(slashCommandSource(options()), "https://x")).toBeNull();
  });

  it("sorts a command the query names to the top, keeping both", () => {
    const result = complete(slashCommandSource(options()), "/link");
    expect(result?.options.map((o) => o.label)).toEqual([
      "Link to note",
      "New note",
    ]);
  });

  it("keeps both commands when the query is an argument, not a command name", () => {
    // `/dep` means "do something with 'dep'" — Link to note must survive.
    const result = complete(slashCommandSource(options()), "/dep");
    expect(result?.options.map((o) => o.label)).toEqual([
      "New note",
      "Link to note",
    ]);
  });

  it("closes once the query runs past a space", () => {
    // A slash palette that stayed open across a sentence would sit over prose.
    expect(complete(slashCommandSource(options()), "/Deploy checklist")).toBeNull();
  });

  it("New note with a typed title creates and links it", async () => {
    const createNote = vi.fn(async (title: string) => ({
      id: "new-note-idz",
      title,
    }));
    const v = mount("/groceries");
    const result = complete(
      slashCommandSource(options({ createNote })),
      "/groceries",
    );
    result?.options[0].apply?.(v, result.options[0], 0, 10);
    await vi.waitFor(() => {
      expect(v!.state.doc.toString()).toBe("[groceries](/n/new-note-idz)");
    });
    expect(createNote).toHaveBeenCalledWith("groceries");
  });

  it("bare New note hands off to the [[ picker", () => {
    const v = mount("/");
    const result = complete(slashCommandSource(options()), "/");
    result?.options[0].apply?.(v, result.options[0], 0, 1);
    expect(v.state.doc.toString()).toBe("[[");
    expect(v.state.selection.main.head).toBe(2);
  });

  it("Link to note carries the typed query into the picker", () => {
    const v = mount("note /dep");
    const result = complete(slashCommandSource(options()), "note /dep");
    const link = result?.options.find((o) => o.label === "Link to note");
    link?.apply?.(v, link, 5, 9);
    expect(v.state.doc.toString()).toBe("note [[dep");
  });

  it("Link to note creates nothing, so it cannot nest a note (#80)", () => {
    const createNote = vi.fn(async (title: string) => ({
      id: "new-note-idz",
      title,
    }));
    const v = mount("note /dep");
    const result = complete(
      slashCommandSource(options({ createNote })),
      "note /dep",
    );
    const link = result?.options.find((o) => o.label === "Link to note");
    link?.apply?.(v, link, 5, 9);
    expect(createNote).not.toHaveBeenCalled();
  });
});

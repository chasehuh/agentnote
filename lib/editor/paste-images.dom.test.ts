/** @vitest-environment jsdom */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imagePasteDrop } from "./paste-images";

let view: EditorView | null = null;

function mount(doc: string, onError?: (message: string) => void) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [imagePasteDrop({ onError })],
    }),
  });
  return view;
}

/**
 * jsdom has no DataTransfer, and the real one cannot be populated with files
 * anyway. `items` is the surface the extension reads; `files`/`getData` are
 * there for CodeMirror's own drop handler, which takes over whenever this
 * extension declines the event.
 */
function dataTransfer(files: File[]) {
  return {
    items: files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    })),
    // Deliberately empty: CodeMirror's fallback handler reads these when this
    // extension declines the event, and it has nothing to do here.
    files: [],
    getData: () => "",
  } as unknown as DataTransfer;
}

/** `new File([...], name, {type})` in jsdom keeps `type: ""` when omitted. */
function file(name: string, type: string) {
  return new File([new Uint8Array([1, 2, 3])], name, type ? { type } : {});
}

function fireDrop(target: EditorView, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer(files) });
  Object.defineProperty(event, "clientX", { value: 0 });
  Object.defineProperty(event, "clientY", { value: 0 });
  target.contentDOM.dispatchEvent(event);
  return event;
}

function respondOk(url: string) {
  return {
    ok: true,
    json: async () => ({ url }),
  } as Response;
}

/** Lets the fire-and-forget upload chain settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("imagePasteDrop drop handler", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uploads a Finder drop with an empty MIME and inserts the Markdown", async () => {
    fetchMock.mockResolvedValue(respondOk("https://media.example/shot.png"));
    // Empty doc: jsdom has no layout, so `posAtCoords` resolves every drop to
    // position 0 and the caret-near-the-pointer behaviour is not observable.
    const editor = mount("");

    const event = fireDrop(editor, [file("shot.png", "")]);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    // Sniffed from the extension, not forwarded as application/octet-stream.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "image/png",
    );
    expect(editor.state.doc.toString()).toBe(
      "![shot](https://media.example/shot.png)",
    );
  });

  it("ignores a drop of non-image files", async () => {
    const editor = mount("note");

    fireDrop(editor, [file("notes.txt", "")]);
    await settle();

    // `defaultPrevented` is CodeMirror's call once this extension declines.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe("note");
  });

  it("reports a failed upload instead of failing silently", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Media upload is not configured" }),
    } as Response);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const editor = mount("note", onError);

    fireDrop(editor, [file("shot.png", "image/png")]);
    await settle();

    expect(onError).toHaveBeenCalledWith(
      "Image upload failed: Media upload is not configured",
    );
    expect(editor.state.doc.toString()).toBe("note");
  });

  it("inserts the survivors of a partly failed drop", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: async () => ({ error: "Image too large" }),
      } as Response)
      .mockResolvedValueOnce(respondOk("https://media.example/b.png"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const editor = mount("", onError);

    fireDrop(editor, [file("a.png", ""), file("b.png", "")]);
    await settle();

    // The first rejection must not cancel the second upload.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(editor.state.doc.toString()).toBe(
      "![b](https://media.example/b.png)",
    );
    expect(onError).toHaveBeenCalledWith(
      "1 of the dropped images failed to upload: Image too large",
    );
  });
});

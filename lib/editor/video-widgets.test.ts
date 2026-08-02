/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { imageWidgets } from "./image-widgets";
import {
  estimateVideoPreviewHeight,
  VideoPreviewWidget,
  videoPreviewContentEqual,
  videoWidgets,
} from "./video-widgets";
import type { MarkdownVideo } from "@/lib/media";

function vid(
  partial: Partial<MarkdownVideo> &
    Pick<MarkdownVideo, "url" | "embedUrl" | "kind">,
): MarkdownVideo {
  return {
    alt: "",
    width: null,
    index: 0,
    length: 10,
    ...partial,
  };
}

describe("videoPreviewContentEqual", () => {
  it("ignores document offsets so edits above do not invalidate identity", () => {
    const a = vid({
      kind: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      index: 10,
    });
    const b = vid({
      kind: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      index: 40,
    });
    expect(videoPreviewContentEqual(a, b)).toBe(true);
    expect(new VideoPreviewWidget(a).eq(new VideoPreviewWidget(b))).toBe(true);
  });
});

describe("estimateVideoPreviewHeight", () => {
  it("uses 16:9 of width plus padding", () => {
    expect(estimateVideoPreviewHeight({ width: 480 })).toBe(
      Math.round(480 * (9 / 16)) + 24,
    );
  });
});

describe("VideoPreviewWidget DOM", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  function mount(doc: string, withImages = false): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: withImages ? [imageWidgets, videoWidgets] : [videoWidgets],
      }),
    });
  }

  it("renders a sandboxed YouTube iframe for markdown image form", () => {
    view = mount("![talk](https://youtu.be/dQw4w9WgXcQ)\n");
    const iframe = view.dom.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe!.src).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe!.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(iframe!.getAttribute("allow")).toContain("picture-in-picture");
    expect(iframe!.getAttribute("loading")).toBe("lazy");
    expect(view.dom.querySelector("img")).toBeNull();
  });

  it("renders <video controls> for direct mp4 URLs on their own line", () => {
    view = mount("https://cdn.example.com/clip.mp4?x=1\n");
    const video = view.dom.querySelector("video");
    expect(video).toBeTruthy();
    expect(video!.controls).toBe(true);
    expect(video!.playsInline).toBe(true);
    expect(video!.getAttribute("src")).toContain("clip.mp4");
  });

  it("does not spawn an image widget for youtube markdown images", () => {
    view = mount("![y](https://youtu.be/dQw4w9WgXcQ)\n", true);
    expect(view.dom.querySelector("iframe")).toBeTruthy();
    expect(view.dom.querySelector("img")).toBeNull();
  });

  it("keeps normal images as <img> when both extensions are active", () => {
    view = mount(
      "![x](https://example.com/a.png)\n![y](https://youtu.be/dQw4w9WgXcQ)\n",
      true,
    );
    expect(view.dom.querySelectorAll("img")).toHaveLength(1);
    expect(view.dom.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("keeps the same iframe node when typing above the embed", () => {
    const doc = "line one\n![talk](https://youtu.be/dQw4w9WgXcQ)\n";
    view = mount(doc);
    const before = view.dom.querySelector("iframe");
    expect(before).toBeTruthy();
    view.dispatch({ changes: { from: 0, insert: "PREFIX " } });
    const after = view.dom.querySelector("iframe");
    expect(after).toBe(before);
  });
});

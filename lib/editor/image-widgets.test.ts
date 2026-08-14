/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateImagePreviewHeight,
  ImagePreviewWidget,
  imagePreviewContentEqual,
  imageWidgets,
  resolveBoundMarkdownImage,
} from "./image-widgets";
import type { MarkdownImage } from "@/lib/media";

function img(
  partial: Partial<MarkdownImage> & Pick<MarkdownImage, "url">,
): MarkdownImage {
  return {
    alt: "",
    width: null,
    height: null,
    index: 0,
    length: 10,
    ...partial,
  };
}

describe("imagePreviewContentEqual", () => {
  it("ignores document offsets so edits above do not invalidate identity", () => {
    const a = img({
      url: "https://example.com/a.png",
      alt: "cat",
      width: 400,
      height: 300,
      index: 10,
      length: 40,
    });
    const b = img({
      url: "https://example.com/a.png",
      alt: "cat",
      width: 400,
      height: 300,
      index: 40,
      length: 40,
    });
    expect(imagePreviewContentEqual(a, b)).toBe(true);
    expect(new ImagePreviewWidget(a).eq(new ImagePreviewWidget(b))).toBe(true);
  });

  it("treats url/alt/size changes as different widgets", () => {
    const base = img({ url: "https://example.com/a.png", alt: "x", width: 400 });
    expect(
      imagePreviewContentEqual(base, img({ ...base, url: "https://example.com/b.png" })),
    ).toBe(false);
    expect(
      imagePreviewContentEqual(base, img({ ...base, alt: "y" })),
    ).toBe(false);
    expect(
      imagePreviewContentEqual(base, img({ ...base, width: 480 })),
    ).toBe(false);
  });
});

describe("estimateImagePreviewHeight", () => {
  it("uses stored height plus widget padding", () => {
    expect(estimateImagePreviewHeight({ width: 400, height: 300 })).toBe(324);
  });

  it("falls back to width × 0.625 when height is missing", () => {
    expect(estimateImagePreviewHeight({ width: 480, height: null })).toBe(
      Math.round(480 * 0.625) + 24,
    );
  });

  it("is exposed on the widget for CM height oracle", () => {
    const widget = new ImagePreviewWidget(
      img({ url: "https://example.com/a.png", width: 400, height: 200 }),
    );
    expect(widget.estimatedHeight).toBe(224);
  });
});

describe("resolveBoundMarkdownImage", () => {
  it("finds the image after an edit shifts its index", () => {
    const host = document.createElement("div") as HTMLElement & {
      __cmImage?: MarkdownImage;
    };
    host.__cmImage = img({
      url: "https://example.com/a.png",
      alt: "shot",
      index: 0,
      length: 40,
    });
    const doc = "hello\n![shot](https://example.com/a.png)\n";
    const found = resolveBoundMarkdownImage(host, doc);
    expect(found?.url).toBe("https://example.com/a.png");
    expect(found?.index).toBeGreaterThan(0);
  });
});

describe("ImagePreviewWidget DOM stability", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  function mount(doc: string): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [imageWidgets],
      }),
    });
  }

  it("keeps the same <img> node when typing above the image", () => {
    const doc = "line one\n![photo|400x300](https://example.com/photo.png)\n";
    view = mount(doc);
    const before = view.dom.querySelector("img");
    expect(before).toBeTruthy();
    const beforeSrc = before!.src;

    view.dispatch({
      changes: { from: 0, insert: "PREFIX " },
    });

    const after = view.dom.querySelector("img");
    expect(after).toBe(before);
    expect(after!.src).toBe(beforeSrc);
  });

  it("calls requestMeasure when the image finishes loading", () => {
    view = mount("![x](https://example.com/x.png)\n");
    const measure = vi.spyOn(view, "requestMeasure");
    const imgEl = view.dom.querySelector("img");
    expect(imgEl).toBeTruthy();
    imgEl!.dispatchEvent(new Event("load"));
    expect(measure).toHaveBeenCalled();
  });

  it("reserves aspect-ratio from markdown dimensions", () => {
    view = mount("![x|400x250](https://example.com/x.png)\n");
    const imgEl = view.dom.querySelector("img");
    expect(imgEl?.getAttribute("width")).toBe("400");
    expect(imgEl?.getAttribute("height")).toBe("250");
    expect(imgEl?.style.aspectRatio.replace(/\s/g, "")).toBe("400/250");
  });

  it("does not invent a 0.625 aspect-ratio for width-only marks", () => {
    view = mount("![shot|466](https://example.com/shot.png)\n");
    const imgEl = view.dom.querySelector("img");
    expect(imgEl?.getAttribute("width")).toBe("466");
    expect(imgEl?.getAttribute("height")).toBeNull();
    expect(imgEl?.style.aspectRatio).toBe("");
  });
});

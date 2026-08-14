import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import {
  extractMarkdownImages,
  markdownImage,
  type MarkdownImage,
} from "@/lib/media";

const DEFAULT_PREVIEW_WIDTH = 480;
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;
/** Vertical padding on `.cm-md-image` (8px top + 16px bottom). */
const IMAGE_WIDGET_PADDING_Y = 24;
/** Fallback aspect when markdown only stores width (`|400`). */
const DEFAULT_ASPECT = 0.625;

type ImageHost = HTMLElement & { __cmImage?: MarkdownImage };

/** Content identity for widget reuse — excludes document offsets. */
export function imagePreviewContentEqual(
  a: Pick<MarkdownImage, "url" | "alt" | "width" | "height">,
  b: Pick<MarkdownImage, "url" | "alt" | "width" | "height">,
): boolean {
  return (
    a.url === b.url &&
    a.alt === b.alt &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** CM height-oracle estimate (Zed `resize_blocks` parity). */
export function estimateImagePreviewHeight(
  image: Pick<MarkdownImage, "width" | "height">,
): number {
  const w = image.width ?? DEFAULT_PREVIEW_WIDTH;
  const h = image.height ?? Math.round(w * DEFAULT_ASPECT);
  return h + IMAGE_WIDGET_PADDING_Y;
}

function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

function bindImage(host: ImageHost, image: MarkdownImage) {
  host.__cmImage = image;
}

/** Resolve the live markdown image for a reused widget DOM node. */
export function resolveBoundMarkdownImage(
  host: ImageHost,
  doc: string,
): MarkdownImage | null {
  const bound = host.__cmImage;
  if (!bound) return null;
  const images = extractMarkdownImages(doc);
  const exact = images.find(
    (item) => item.index === bound.index && item.url === bound.url,
  );
  if (exact) return exact;

  const same = images.filter(
    (item) => item.url === bound.url && item.alt === bound.alt,
  );
  if (same.length === 0) return null;
  if (same.length === 1) return same[0]!;
  return same.reduce((best, item) =>
    Math.abs(item.index - bound.index) < Math.abs(best.index - bound.index)
      ? item
      : best,
  );
}

function applyPreviewBox(host: HTMLElement, image: MarkdownImage) {
  const width = image.width ?? DEFAULT_PREVIEW_WIDTH;
  host.style.width = `${width}px`;
  const img = host.querySelector("img");
  if (!(img instanceof HTMLImageElement)) return;
  img.alt = image.alt || "";
  if (image.width != null) {
    img.width = image.width;
  } else {
    img.removeAttribute("width");
  }
  if (image.height != null) {
    img.height = image.height;
    img.style.aspectRatio = `${image.width ?? width} / ${image.height}`;
    return;
  }
  img.removeAttribute("height");
  // Width-only (`|466`) must not invent a ratio — that stretches screenshots.
  // After decode, lock the natural ratio so remounts reserve height without
  // a jump. Before decode, leave `height: auto` (CSS) and let `load` measure.
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  } else {
    img.style.removeProperty("aspect-ratio");
  }
}

export class ImagePreviewWidget extends WidgetType {
  constructor(readonly image: MarkdownImage) {
    super();
  }

  eq(other: ImagePreviewWidget) {
    // Do not compare index/length — edits above shift offsets and would
    // force every subsequent widget to recreate (scroll thrash).
    return imagePreviewContentEqual(this.image, other.image);
  }

  get estimatedHeight() {
    return estimateImagePreviewHeight(this.image);
  }

  updateDOM(dom: HTMLElement, _view: EditorView) {
    bindImage(dom as ImageHost, this.image);
    applyPreviewBox(dom, this.image);
    const handle = dom.querySelector(".cm-md-image__handle");
    if (handle instanceof HTMLElement) {
      handle.title = `${this.image.width ?? DEFAULT_PREVIEW_WIDTH}px — drag to resize; double-click to reset`;
    }
    return true;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div") as ImageHost;
    wrap.className = "cm-md-image";
    bindImage(wrap, this.image);

    const img = document.createElement("img");
    img.src = this.image.url;
    img.draggable = false;
    img.addEventListener(
      "load",
      () => {
        applyPreviewBox(wrap, this.image);
        view.requestMeasure();
      },
      { once: true },
    );
    img.addEventListener("mousedown", (event) => {
      // Keep focus/selection work on click without starting a text drag.
      event.preventDefault();
    });
    img.addEventListener("click", () => {
      const current = resolveBoundMarkdownImage(wrap, view.state.doc.toString());
      if (!current) return;
      view.dispatch({
        selection: {
          anchor: current.index,
          head: current.index + current.length,
        },
        scrollIntoView: true,
      });
      view.focus();
    });

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "cm-md-image__handle";
    handle.setAttribute("aria-label", "Resize image");

    let draftWidth = this.image.width ?? DEFAULT_PREVIEW_WIDTH;
    let start: { x: number; width: number } | null = null;

    const applyWidth = (width: number | null) => {
      const current = resolveBoundMarkdownImage(wrap, view.state.doc.toString());
      if (!current) return;
      const insert =
        width == null
          ? markdownImage(current.url, current.alt)
          : markdownImage(current.url, current.alt, clampWidth(width));
      const doc = view.state.doc.toString();
      const existing = doc.slice(current.index, current.index + current.length);
      if (existing === insert) return;
      view.dispatch({
        changes: {
          from: current.index,
          to: current.index + current.length,
          insert,
        },
        userEvent: "input",
      });
    };

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      start = { x: event.clientX, width: draftWidth };

      const onMove = (moveEvent: PointerEvent) => {
        if (!start) return;
        draftWidth = clampWidth(start.width + (moveEvent.clientX - start.x));
        wrap.style.width = `${draftWidth}px`;
        handle.title = `${draftWidth}px — drag to resize; double-click to reset`;
      };

      const onUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        if (!start) return;
        const next = clampWidth(start.width + (upEvent.clientX - start.x));
        start = null;
        draftWidth = next;
        applyWidth(next);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });

    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      draftWidth = DEFAULT_PREVIEW_WIDTH;
      wrap.style.width = `${DEFAULT_PREVIEW_WIDTH}px`;
      applyWidth(null);
    });

    wrap.append(img, handle);
    applyPreviewBox(wrap, this.image);
    handle.title = `${this.image.width ?? DEFAULT_PREVIEW_WIDTH}px — drag to resize; double-click to reset`;
    return wrap;
  }

  ignoreEvent(event: Event) {
    // Let pointer handlers on the widget run; don't let CM treat them as editing.
    return (
      event.type.startsWith("pointer") ||
      event.type === "mousedown" ||
      event.type === "click" ||
      event.type === "dblclick"
    );
  }
}

function buildImageDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // extractMarkdownImages already skips video URLs (owned by videoWidgets).
  const images = extractMarkdownImages(doc);
  // Sort by index so RangeSetBuilder gets ascending positions.
  const sorted = [...images].sort((a, b) => a.index - b.index);
  for (const image of sorted) {
    // Anchor at end of the markdown mark so multiple images on one line still stack.
    const anchor = image.index + image.length;
    builder.add(
      anchor,
      anchor,
      Decoration.widget({
        widget: new ImagePreviewWidget(image),
        block: true,
        side: 1,
      }),
    );
  }
  return builder.finish();
}

/** Ordered image content (no offsets) — detects mark add/remove/edit only. */
function imageContentSignature(doc: string): string {
  return extractMarkdownImages(doc)
    .map(
      (image) =>
        `${image.url}\0${image.alt}\0${image.width}\0${image.height}\0${image.length}`,
    )
    .join("\n");
}

export const imageWidgets = StateField.define<DecorationSet>({
  create(state) {
    return buildImageDecorations(state.doc.toString());
  },
  update(decorations, tr) {
    if (!tr.docChanged) {
      return decorations.map(tr.changes);
    }
    const mapped = decorations.map(tr.changes);
    const prevDoc = tr.startState.doc.toString();
    const nextDoc = tr.state.doc.toString();
    // Text that only shift positions: map ranges through the ChangeSet.
    // Handlers re-resolve markdown via resolveBoundMarkdownImage.
    if (imageContentSignature(prevDoc) === imageContentSignature(nextDoc)) {
      return mapped;
    }
    // Mark content changed — rebuild. eq()/updateDOM keep <img> DOM stable
    // when url/alt/size are unchanged.
    return buildImageDecorations(nextDoc);
  },
  provide: (field) => EditorView.decorations.from(field),
});

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

function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

class ImagePreviewWidget extends WidgetType {
  constructor(readonly image: MarkdownImage) {
    super();
  }

  eq(other: ImagePreviewWidget) {
    return (
      this.image.index === other.image.index &&
      this.image.length === other.image.length &&
      this.image.url === other.image.url &&
      this.image.alt === other.image.alt &&
      this.image.width === other.image.width &&
      this.image.height === other.image.height
    );
  }

  toDOM(view: EditorView) {
    const image = this.image;
    const wrap = document.createElement("div");
    wrap.className = "cm-md-image";
    wrap.style.width = `${image.width ?? DEFAULT_PREVIEW_WIDTH}px`;

    const img = document.createElement("img");
    img.src = image.url;
    img.alt = image.alt || "";
    img.draggable = false;
    img.addEventListener("mousedown", (event) => {
      // Keep focus/selection work on click without starting a text drag.
      event.preventDefault();
    });
    img.addEventListener("click", () => {
      view.dispatch({
        selection: {
          anchor: image.index,
          head: image.index + image.length,
        },
        scrollIntoView: true,
      });
      view.focus();
    });

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "cm-md-image__handle";
    handle.setAttribute("aria-label", "Resize image");
    handle.title = `${image.width ?? DEFAULT_PREVIEW_WIDTH}px — drag to resize; double-click to reset`;

    let draftWidth = image.width ?? DEFAULT_PREVIEW_WIDTH;
    let start: { x: number; width: number } | null = null;

    const applyWidth = (width: number | null) => {
      const doc = view.state.doc.toString();
      const current = extractMarkdownImages(doc).find(
        (item) =>
          item.index === image.index ||
          (item.url === image.url &&
            item.index <= image.index &&
            item.index + item.length >= image.index),
      );
      if (!current) return;
      const insert =
        width == null
          ? markdownImage(current.url, current.alt)
          : markdownImage(current.url, current.alt, clampWidth(width));
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

export const imageWidgets = StateField.define<DecorationSet>({
  create(state) {
    return buildImageDecorations(state.doc.toString());
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildImageDecorations(tr.state.doc.toString());
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

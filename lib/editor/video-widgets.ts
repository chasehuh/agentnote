import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import {
  extractMarkdownVideos,
  type MarkdownVideo,
} from "@/lib/media";

const DEFAULT_PREVIEW_WIDTH = 480;
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;
/** Vertical padding on `.cm-md-video` (8px top + 16px bottom). */
const VIDEO_WIDGET_PADDING_Y = 24;
/** Default 16:9 aspect when markdown only stores width. */
const DEFAULT_ASPECT = 9 / 16;

/**
 * YouTube/Vimeo players need scripts + same-origin within the allowlisted
 * embed host. Hosts are constrained by `parseVideoUrl` (never arbitrary URLs).
 */
const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

type VideoHost = HTMLElement & { __cmVideo?: MarkdownVideo };

function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

/** Content identity for widget reuse — excludes document offsets. */
export function videoPreviewContentEqual(
  a: Pick<MarkdownVideo, "kind" | "url" | "embedUrl" | "alt" | "width">,
  b: Pick<MarkdownVideo, "kind" | "url" | "embedUrl" | "alt" | "width">,
): boolean {
  return (
    a.kind === b.kind &&
    a.url === b.url &&
    a.embedUrl === b.embedUrl &&
    a.alt === b.alt &&
    a.width === b.width
  );
}

/** CM height-oracle estimate (16:9 of fitted width + padding). */
export function estimateVideoPreviewHeight(
  video: Pick<MarkdownVideo, "width">,
): number {
  const w = video.width ?? DEFAULT_PREVIEW_WIDTH;
  return Math.round(w * DEFAULT_ASPECT) + VIDEO_WIDGET_PADDING_Y;
}

function bindVideo(host: VideoHost, video: MarkdownVideo) {
  host.__cmVideo = video;
}

/** Resolve the live markdown video for a reused widget DOM node. */
export function resolveBoundMarkdownVideo(
  host: VideoHost,
  doc: string,
): MarkdownVideo | null {
  const bound = host.__cmVideo;
  if (!bound) return null;
  const videos = extractMarkdownVideos(doc);
  const exact = videos.find(
    (item) => item.index === bound.index && item.url === bound.url,
  );
  if (exact) return exact;

  const same = videos.filter(
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

function applyPreviewBox(host: HTMLElement, video: MarkdownVideo) {
  const width = clampWidth(video.width ?? DEFAULT_PREVIEW_WIDTH);
  host.style.width = `${width}px`;
  host.style.aspectRatio = `${width} / ${Math.round(width * DEFAULT_ASPECT)}`;
  const media = host.querySelector("iframe, video");
  if (media instanceof HTMLIFrameElement) {
    media.title = video.alt || "Embedded video";
    if (media.src !== video.embedUrl) {
      media.src = video.embedUrl;
    }
  } else if (media instanceof HTMLVideoElement) {
    if (media.src !== video.embedUrl) {
      media.src = video.embedUrl;
    }
  }
}

function createPlayer(video: MarkdownVideo): HTMLElement {
  if (video.kind === "file") {
    const el = document.createElement("video");
    el.className = "cm-md-video__player";
    el.controls = true;
    el.playsInline = true;
    el.preload = "metadata";
    el.src = video.embedUrl;
    return el;
  }

  const el = document.createElement("iframe");
  el.className = "cm-md-video__player";
  el.src = video.embedUrl;
  el.title = video.alt || "Embedded video";
  el.setAttribute("sandbox", IFRAME_SANDBOX);
  el.setAttribute("allow", IFRAME_ALLOW);
  el.setAttribute("allowfullscreen", "");
  el.setAttribute("loading", "lazy");
  el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  return el;
}

export class VideoPreviewWidget extends WidgetType {
  constructor(readonly video: MarkdownVideo) {
    super();
  }

  eq(other: VideoPreviewWidget) {
    // Do not compare index/length — edits above shift offsets and would
    // force every subsequent widget to recreate (scroll thrash).
    return videoPreviewContentEqual(this.video, other.video);
  }

  get estimatedHeight() {
    return estimateVideoPreviewHeight(this.video);
  }

  updateDOM(dom: HTMLElement, _view: EditorView) {
    bindVideo(dom as VideoHost, this.video);
    applyPreviewBox(dom, this.video);
    return true;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div") as VideoHost;
    wrap.className = "cm-md-video";
    wrap.dataset.kind = this.video.kind;
    bindVideo(wrap, this.video);

    const player = createPlayer(this.video);
    // Selecting the source mark on chrome click; let player receive its own
    // pointer events (iframe / video controls).
    wrap.addEventListener("click", (event) => {
      if (event.target !== wrap) return;
      const current = resolveBoundMarkdownVideo(wrap, view.state.doc.toString());
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

    wrap.append(player);
    applyPreviewBox(wrap, this.video);
    return wrap;
  }

  ignoreEvent(event: Event) {
    // Let pointer handlers / iframe / video controls run; don't let CM treat
    // them as editing.
    return (
      event.type.startsWith("pointer") ||
      event.type === "mousedown" ||
      event.type === "mouseup" ||
      event.type === "click" ||
      event.type === "dblclick"
    );
  }
}

function buildVideoDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const videos = extractMarkdownVideos(doc);
  const sorted = [...videos].sort((a, b) => a.index - b.index);
  for (const video of sorted) {
    const anchor = video.index + video.length;
    builder.add(
      anchor,
      anchor,
      Decoration.widget({
        widget: new VideoPreviewWidget(video),
        block: true,
        side: 1,
      }),
    );
  }
  return builder.finish();
}

/** Ordered video content (no offsets) — detects mark add/remove/edit only. */
function videoContentSignature(doc: string): string {
  return extractMarkdownVideos(doc)
    .map(
      (video) =>
        `${video.kind}\0${video.url}\0${video.embedUrl}\0${video.alt}\0${video.width}\0${video.length}`,
    )
    .join("\n");
}

export const videoWidgets = StateField.define<DecorationSet>({
  create(state) {
    return buildVideoDecorations(state.doc.toString());
  },
  update(decorations, tr) {
    if (!tr.docChanged) {
      return decorations.map(tr.changes);
    }
    const mapped = decorations.map(tr.changes);
    const prevDoc = tr.startState.doc.toString();
    const nextDoc = tr.state.doc.toString();
    if (videoContentSignature(prevDoc) === videoContentSignature(nextDoc)) {
      return mapped;
    }
    return buildVideoDecorations(nextDoc);
  },
  provide: (field) => EditorView.decorations.from(field),
});

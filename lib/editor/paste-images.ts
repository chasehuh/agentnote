import { EditorView } from "@codemirror/view";
import { markdownImage } from "@/lib/media";

const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

type PendingImage = { file: File; type: string };

/**
 * The MIME type to upload a dropped/pasted file as, or `null` when it is not
 * an image.
 *
 * Finder hands over drops with an empty `File.type`, so a `.png` off the
 * desktop is indistinguishable from a text file by MIME alone. The extension
 * is the only signal left, so fall back to it.
 */
export function imageTypeForFile(file: {
  name: string;
  type: string;
}): string | null {
  const declared = file.type.split(";")[0].trim().toLowerCase();
  if (declared) {
    return declared.startsWith("image/") ? declared : null;
  }
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return IMAGE_TYPE_BY_EXTENSION[extension] ?? null;
}

function imageFilesFrom(data: DataTransfer | null): PendingImage[] {
  if (!data) return [];
  const images: PendingImage[] = [];
  for (const item of data.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const type = imageTypeForFile(file);
    if (type) images.push({ file, type });
  }
  return images;
}

/**
 * Drag events hide file names for privacy, so an empty-type item during
 * `dragover` cannot be sniffed yet — accept it and let `drop` decide.
 */
function hasImageCandidates(data: DataTransfer | null) {
  if (!data) return false;
  return [...data.items].some(
    (item) =>
      item.kind === "file" &&
      (item.type === "" || item.type.startsWith("image/")),
  );
}

async function uploadImageFile(file: File, type: string): Promise<string> {
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": type },
    body: file,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error || `Upload failed (${response.status})`);
  }
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error("Upload response missing url");
  return data.url;
}

function insertMarkdownAtSelection(view: EditorView, snippet: string) {
  const { from, to } = view.state.selection.main;
  const before = view.state.doc.sliceString(0, from);
  const after = view.state.doc.sliceString(to);
  const needsLeadingNewline =
    before.length > 0 && !before.endsWith("\n") && !snippet.startsWith("\n");
  const needsTrailingNewline =
    after.length > 0 && !after.startsWith("\n") && !snippet.endsWith("\n");
  const block =
    (needsLeadingNewline ? "\n" : "") +
    snippet +
    (needsTrailingNewline ? "\n" : "");
  const insertAt = from;
  view.dispatch({
    changes: { from, to, insert: block },
    selection: { anchor: insertAt + block.length },
    scrollIntoView: true,
  });
}

/** Human-readable summary of a batch where `failed` of `total` did not upload. */
export function uploadFailureMessage(
  failed: number,
  total: number,
  detail: string | null,
): string {
  const subject =
    failed === 1
      ? total === 1
        ? "Image upload failed"
        : "1 of the dropped images failed to upload"
      : `${failed} of ${total} images failed to upload`;
  return detail ? `${subject}: ${detail}` : subject;
}

async function uploadAndInsert(
  view: EditorView,
  images: PendingImage[],
  onError?: (message: string) => void,
) {
  let failed = 0;
  let firstDetail: string | null = null;
  // Per-file, so one rejected image does not swallow the rest of the drop.
  for (const { file, type } of images) {
    try {
      const url = await uploadImageFile(file, type);
      const alt = file.name.replace(/\.[^.]+$/, "") || "image";
      insertMarkdownAtSelection(view, markdownImage(url, alt));
    } catch (error) {
      failed += 1;
      if (!firstDetail) {
        firstDetail = error instanceof Error ? error.message : null;
      }
      console.error("image upload failed", error);
    }
  }
  if (failed > 0) {
    onError?.(uploadFailureMessage(failed, images.length, firstDetail));
  }
}

export type ImagePasteDropOptions = {
  /**
   * Called with a user-facing sentence when any file in a paste/drop did not
   * upload. Uploads are fire-and-forget, so without this the failure has
   * nowhere to surface.
   */
  onError?: (message: string) => void;
};

/** Paste/drop image files → `/api/upload` → insert Markdown at caret. */
export function imagePasteDrop(options: ImagePasteDropOptions = {}) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const images = imageFilesFrom(event.clipboardData);
      if (images.length === 0) return false;
      event.preventDefault();
      void uploadAndInsert(view, images, options.onError);
      return true;
    },
    dragover(event) {
      if (!hasImageCandidates(event.dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      const images = imageFilesFrom(event.dataTransfer);
      if (images.length === 0) return false;
      event.preventDefault();
      // Move caret near drop point when possible.
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos != null) {
        view.dispatch({ selection: { anchor: pos } });
      }
      void uploadAndInsert(view, images, options.onError);
      return true;
    },
  });
}

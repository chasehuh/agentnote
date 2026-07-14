import { EditorView } from "@codemirror/view";
import { markdownImage } from "@/lib/media";

async function uploadImageFile(file: File): Promise<string> {
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
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

function collectImageFilesFromClipboard(
  data: DataTransfer | null,
): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
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

async function uploadAndInsert(view: EditorView, files: File[]) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) return;
  try {
    for (const file of images) {
      const url = await uploadImageFile(file);
      const alt = file.name.replace(/\.[^.]+$/, "") || "image";
      insertMarkdownAtSelection(view, markdownImage(url, alt));
    }
  } catch (error) {
    console.error("image upload failed", error);
  }
}

function hasImageFiles(data: DataTransfer | null) {
  if (!data) return false;
  return [...data.items].some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

/** Paste/drop image files → `/api/upload` → insert Markdown at caret. */
export function imagePasteDrop() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = collectImageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return false;
      event.preventDefault();
      void uploadAndInsert(view, files);
      return true;
    },
    dragover(event) {
      if (!hasImageFiles(event.dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return false;
      event.preventDefault();
      // Move caret near drop point when possible.
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos != null) {
        view.dispatch({ selection: { anchor: pos } });
      }
      void uploadAndInsert(view, files);
      return true;
    },
  });
}

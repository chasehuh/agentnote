import { randomUUID } from "crypto";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function mediaUploadConfigured() {
  return Boolean(
    process.env.MEDIA_UPLOAD_URL?.trim() &&
      process.env.MEDIA_UPLOAD_SECRET?.trim(),
  );
}

export function isAllowedImageType(type: string) {
  return ALLOWED.has(type.split(";")[0].trim().toLowerCase());
}

export function markdownImage(url: string, alt = "", width?: number | null) {
  const label =
    width && Number.isFinite(width) && width > 0
      ? `${alt}|${Math.round(width)}`
      : alt;
  return `![${label}](${url})`;
}

export type MarkdownImage = {
  alt: string;
  width: number | null;
  height: number | null;
  url: string;
  index: number;
  length: number;
};

function parseImageLabel(label: string): {
  alt: string;
  width: number | null;
  height: number | null;
} {
  // Obsidian: ![alt|400], ![alt|400x300], ![400]
  const sized = label.match(/^(.*?)(?:\|(\d+)(?:x(\d+))?)?$/);
  if (!sized) {
    return { alt: label, width: null, height: null };
  }
  const rawAlt = (sized[1] ?? "").trimEnd();
  const width = sized[2] ? Number(sized[2]) : null;
  const height = sized[3] ? Number(sized[3]) : null;
  // ![400](url) — bare width in brackets
  if (!rawAlt && width != null) {
    return { alt: "", width, height };
  }
  if (/^\d+$/.test(rawAlt) && width == null) {
    return { alt: "", width: Number(rawAlt), height: null };
  }
  return {
    alt: rawAlt,
    width: width != null && Number.isFinite(width) ? width : null,
    height: height != null && Number.isFinite(height) ? height : null,
  };
}

/** Obsidian/Notion-style image markdown: ![alt|400](url) */
export function extractMarkdownImages(text: string): MarkdownImage[] {
  const out: MarkdownImage[] = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(re)) {
    const label = match[1] ?? "";
    const parsed = parseImageLabel(label);
    out.push({
      ...parsed,
      url: match[2] ?? "",
      index: match.index ?? 0,
      length: match[0]?.length ?? 0,
    });
  }
  return out;
}

export function withMarkdownImageWidth(
  text: string,
  image: Pick<MarkdownImage, "index" | "length" | "alt" | "url">,
  width: number,
): string {
  const nextWidth = Math.max(80, Math.min(1600, Math.round(width)));
  const next = markdownImage(image.url, image.alt, nextWidth);
  return (
    text.slice(0, image.index) + next + text.slice(image.index + image.length)
  );
}

/** Clear Obsidian `|width` / `|WxH` from an image mark (reset to natural size). */
export function withoutMarkdownImageWidth(
  text: string,
  image: Pick<MarkdownImage, "index" | "length" | "alt" | "url">,
): string {
  const next = markdownImage(image.url, image.alt);
  return (
    text.slice(0, image.index) + next + text.slice(image.index + image.length)
  );
}


export async function uploadImageBytes(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ url: string; key?: string }> {
  const endpoint = process.env.MEDIA_UPLOAD_URL?.trim();
  const secret = process.env.MEDIA_UPLOAD_SECRET?.trim();
  if (!endpoint || !secret) {
    throw new Error("Media upload is not configured");
  }

  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(type)) {
    throw new Error(`Unsupported image type: ${type}`);
  }
  if (bytes.byteLength === 0) {
    throw new Error("Empty image");
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("Image too large");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": type,
      "X-Upload-Id": randomUUID(),
      "User-Agent": "memo-upload/1.0",
    },
    body: bytes,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Upload failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const data = (await response.json()) as { url?: string; key?: string };
  if (!data.url) {
    throw new Error("Upload response missing url");
  }
  return { url: data.url, key: data.key };
}

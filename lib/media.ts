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

export type VideoKind = "youtube" | "vimeo" | "file";

export type ParsedVideoUrl = {
  kind: VideoKind;
  /** Safe embed/src URL for the player */
  embedUrl: string;
  id?: string;
};

export type MarkdownVideo = {
  kind: VideoKind;
  /** Original URL as written in the note */
  url: string;
  /** Safe embed/src URL for the player */
  embedUrl: string;
  alt: string;
  width: number | null;
  index: number;
  length: number;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);

const VIDEO_FILE_EXT_RE = /\.(mp4|webm|ogg)$/i;

function isYouTubeId(id: string) {
  return /^[\w-]{6,}$/.test(id);
}

/**
 * Detect allowlisted provider embeds or direct video file URLs.
 * Only http(s); iframe hosts are allowlisted (no arbitrary oEmbed fetch).
 */
export function parseVideoUrl(url: string): ParsedVideoUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!isYouTubeId(id)) return null;
    return {
      kind: "youtube",
      id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  }

  if (YOUTUBE_HOSTS.has(host)) {
    const v = parsed.searchParams.get("v");
    if (v && isYouTubeId(v)) {
      return {
        kind: "youtube",
        id: v,
        embedUrl: `https://www.youtube-nocookie.com/embed/${v}`,
      };
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (
      (parts[0] === "embed" || parts[0] === "shorts") &&
      parts[1] &&
      isYouTubeId(parts[1])
    ) {
      return {
        kind: "youtube",
        id: parts[1],
        embedUrl: `https://www.youtube-nocookie.com/embed/${parts[1]}`,
      };
    }
    return null;
  }

  if (VIMEO_HOSTS.has(host)) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    let id: string | undefined;
    if (parts[0] === "video" && parts[1] && /^\d+$/.test(parts[1])) {
      id = parts[1];
    } else if (parts[0] && /^\d+$/.test(parts[0])) {
      id = parts[0];
    }
    if (!id) return null;
    return {
      kind: "vimeo",
      id,
      embedUrl: `https://player.vimeo.com/video/${id}`,
    };
  }

  if (host === "player.vimeo.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "video" && parts[1] && /^\d+$/.test(parts[1])) {
      return {
        kind: "vimeo",
        id: parts[1],
        embedUrl: `https://player.vimeo.com/video/${parts[1]}`,
      };
    }
    return null;
  }

  // Direct files: extension on the path only (query/hash ignored).
  if (VIDEO_FILE_EXT_RE.test(parsed.pathname)) {
    return { kind: "file", embedUrl: url };
  }

  return null;
}

/** Obsidian/Notion-style image markdown: ![alt|400](url) */
export function extractMarkdownImages(text: string): MarkdownImage[] {
  const out: MarkdownImage[] = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(re)) {
    const url = match[2] ?? "";
    // Video markdown images are owned by video widgets — skip to avoid broken <img>.
    if (parseVideoUrl(url)) continue;
    const label = match[1] ?? "";
    const parsed = parseImageLabel(label);
    out.push({
      ...parsed,
      url,
      index: match.index ?? 0,
      length: match[0]?.length ?? 0,
    });
  }
  return out;
}

/**
 * Video targets from `![alt|width](video-url)` and bare provider/file URLs
 * on their own line.
 */
export function extractMarkdownVideos(text: string): MarkdownVideo[] {
  const out: MarkdownVideo[] = [];
  const covered = new Set<string>();

  const markRange = (index: number, length: number) => {
    covered.add(`${index}:${length}`);
  };
  const isCovered = (index: number, length: number) =>
    covered.has(`${index}:${length}`);

  const imageRe = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(imageRe)) {
    const url = match[2] ?? "";
    const parsed = parseVideoUrl(url);
    if (!parsed) continue;
    const index = match.index ?? 0;
    const length = match[0]?.length ?? 0;
    const label = parseImageLabel(match[1] ?? "");
    out.push({
      kind: parsed.kind,
      url,
      embedUrl: parsed.embedUrl,
      alt: label.alt,
      width: label.width,
      index,
      length,
    });
    markRange(index, length);
  }

  // Bare http(s) URL alone on a line (Obsidian-like paste UX).
  const lineRe = /^(https?:\/\/[^\s]+)\s*$/gm;
  for (const match of text.matchAll(lineRe)) {
    const url = match[1] ?? "";
    const parsed = parseVideoUrl(url);
    if (!parsed) continue;
    const index = match.index ?? 0;
    const length = url.length;
    if (isCovered(index, length)) continue;
    // Skip if this span sits inside an already-captured markdown image mark.
    const overlapsImage = out.some(
      (video) => index >= video.index && index < video.index + video.length,
    );
    if (overlapsImage) continue;
    out.push({
      kind: parsed.kind,
      url,
      embedUrl: parsed.embedUrl,
      alt: "",
      width: null,
      index,
      length,
    });
    markRange(index, length);
  }

  return out.sort((a, b) => a.index - b.index);
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


function extensionForType(type: string) {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "bin";
  }
}

export async function uploadImageBytes(
  bytes: ArrayBuffer,
  contentType: string,
  options?: { keyPrefix?: string },
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

  const uploadId = randomUUID();
  const keyPrefix = options?.keyPrefix?.replace(/\/+$/, "");
  const objectKey = keyPrefix
    ? `${keyPrefix}/${uploadId}.${extensionForType(type)}`
    : undefined;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": type,
      "X-Upload-Id": uploadId,
      ...(objectKey ? { "X-Upload-Key": objectKey } : {}),
      "User-Agent": "agentnote-upload/1.0",
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

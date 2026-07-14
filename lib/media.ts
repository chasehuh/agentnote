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

export function markdownImage(url: string, alt = "") {
  return `![${alt}](${url})`;
}

/** Obsidian/Notion-style image markdown: ![alt](url) */
export function extractMarkdownImages(text: string): Array<{
  alt: string;
  url: string;
  index: number;
}> {
  const out: Array<{ alt: string; url: string; index: number }> = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(re)) {
    out.push({
      alt: match[1] ?? "",
      url: match[2] ?? "",
      index: match.index ?? 0,
    });
  }
  return out;
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

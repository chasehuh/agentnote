export interface Env {
  MEDIA: R2Bucket;
  UPLOAD_SECRET: string;
  /** Public origin for returned URLs, e.g. https://agentnote-media-upload.…workers.dev */
  PUBLIC_ORIGIN?: string;
}

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const MAX_BYTES = 12 * 1024 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

function publicOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_ORIGIN?.replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" || request.method === "HEAD") {
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!key || key.includes("..")) return json({ error: "Not found" }, 404);
      const object = await env.MEDIA.get(key);
      if (!object) return json({ error: "Not found" }, 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(object.body, { headers });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token || token !== env.UPLOAD_SECRET) return unauthorized();

    const type = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED.has(type)) {
      return json({ error: `Unsupported image type: ${type}` }, 415);
    }

    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) return json({ error: "Empty image" }, 400);
    if (bytes.byteLength > MAX_BYTES) {
      return json({ error: "Image too large" }, 413);
    }

    const uploadId = request.headers.get("x-upload-id")?.trim() || crypto.randomUUID();
    const requestedKey = request.headers.get("x-upload-key")?.trim();
    const ext =
      type === "image/jpeg"
        ? "jpg"
        : type === "image/png"
          ? "png"
          : type === "image/gif"
            ? "gif"
            : type === "image/webp"
              ? "webp"
              : type === "image/avif"
                ? "avif"
                : "bin";
    const key =
      requestedKey &&
      !requestedKey.includes("..") &&
      !requestedKey.startsWith("/")
        ? requestedKey
        : `agentnote/${uploadId}.${ext}`;

    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: type },
    });

    const origin = publicOrigin(request, env);
    return json({ url: `${origin}/${key}`, key }, 201);
  },
};

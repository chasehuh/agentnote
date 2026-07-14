import { NextResponse } from "next/server";
import {
  isAllowedImageType,
  mediaUploadConfigured,
  uploadImageBytes,
} from "@/lib/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!mediaUploadConfigured()) {
    return NextResponse.json(
      { error: "Media upload is not configured" },
      { status: 503 },
    );
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";

    let bytes: ArrayBuffer;
    let type: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      type = file.type || "application/octet-stream";
      bytes = await file.arrayBuffer();
    } else {
      type = contentType.split(";")[0].trim() || "application/octet-stream";
      bytes = await request.arrayBuffer();
    }

    if (!isAllowedImageType(type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${type}` },
        { status: 415 },
      );
    }

    const uploaded = await uploadImageBytes(bytes, type);
    return NextResponse.json(
      { url: uploaded.url, key: uploaded.key },
      { status: 201 },
    );
  } catch (error) {
    console.error("image upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

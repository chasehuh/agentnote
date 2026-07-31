import { NextResponse } from "next/server";
import {
  MAX_DOC_UPDATE_BASE64_CHARS,
  MAX_DOC_UPDATE_BYTES,
  base64ToBytes,
  bytesToBase64,
} from "@/lib/crdt/note-doc";
import { syncNoteDoc } from "@/lib/crdt/note-doc-store";
import { isValidNoteId } from "@/lib/note-id";
import { resolveCanonicalNoteId } from "@/lib/notes";
import { requireUserId } from "@/lib/require-user";

type Params = { params: Promise<{ id: string }> };

type SyncPayload = {
  update?: unknown;
  state_vector?: unknown;
  since?: unknown;
};

type DecodeResult =
  | { ok: true; bytes: Uint8Array | null }
  | { ok: false; status: 400 | 413 };

function notFoundResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function decodeBinaryField(value: unknown): DecodeResult {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: true, bytes: null };
  }
  // Bound the encoded string before decoding so an oversized body is rejected
  // without allocating it.
  if (value.length > MAX_DOC_UPDATE_BASE64_CHARS) {
    return { ok: false, status: 413 };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    return { ok: false, status: 400 };
  }
  if (bytes.length > MAX_DOC_UPDATE_BYTES) {
    return { ok: false, status: 413 };
  }
  return { ok: true, bytes };
}

/**
 * Push + pull in one round trip — the y-protocols `SyncStep1 + Update` shape
 * over HTTP. Appends the caller's update, re-projects `notes.body`, and returns
 * the diff the caller is missing.
 */
export async function POST(request: Request, { params }: Params) {
  const authResult = await requireUserId();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!isValidNoteId(id)) return notFoundResponse();

  try {
    const payload = (await request.json()) as SyncPayload;

    const update = decodeBinaryField(payload.update);
    if (!update.ok) {
      return NextResponse.json(
        {
          error:
            update.status === 413 ? "Update too large" : "Invalid update",
        },
        { status: update.status },
      );
    }
    const stateVector = decodeBinaryField(payload.state_vector);
    if (!stateVector.ok) {
      return NextResponse.json(
        {
          error:
            stateVector.status === 413
              ? "State vector too large"
              : "Invalid state vector",
        },
        { status: stateVector.status },
      );
    }

    const since =
      typeof payload.since === "number" && Number.isInteger(payload.since)
        ? payload.since
        : null;

    const canonicalId = await resolveCanonicalNoteId(authResult.userId, id);
    if (!canonicalId) return notFoundResponse();

    const result = await syncNoteDoc({
      userId: authResult.userId,
      noteId: canonicalId,
      update: update.bytes,
      stateVector: stateVector.bytes,
      since,
    });

    if (result.status === "not_found") return notFoundResponse();
    if (result.status === "invalid_update") {
      return NextResponse.json({ error: "Invalid update" }, { status: 400 });
    }

    return NextResponse.json({
      seq: result.seq,
      update: result.update ? bytesToBase64(result.update) : null,
      body: result.body,
      updated_at: result.updatedAt,
    });
  } catch (error) {
    console.error("sync note doc failed", error);
    return NextResponse.json(
      { error: "Failed to sync note doc" },
      { status: 500 },
    );
  }
}

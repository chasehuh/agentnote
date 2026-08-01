import { describe, expect, it, vi } from "vitest";
import { authorizeNoteRoom, isOriginAllowed } from "./room-auth";

const NOTE_ID = "abc-defg-hij";
const OTHER_NOTE_ID = "xyz-mnop-qrs";

function deps(overrides: Partial<Parameters<typeof authorizeNoteRoom>[0]> = {}) {
  return {
    token: "valid-token",
    documentName: NOTE_ID,
    origin: null,
    allowedOrigins: [] as string[],
    verifyToken: vi.fn(async () => ({ sub: "user_1" })),
    resolveOwnedNoteId: vi.fn(async (userId: string, noteId: string) =>
      userId === "user_1" && noteId === NOTE_ID ? NOTE_ID : null,
    ),
    ...overrides,
  };
}

describe("isOriginAllowed", () => {
  it("allows anything when no allowlist is configured", () => {
    expect(isOriginAllowed(null, [])).toBe(true);
    expect(isOriginAllowed("https://evil.example", [])).toBe(true);
  });

  it("enforces the allowlist when one is configured", () => {
    const allowed = ["https://memo.chasehuh.com"];
    expect(isOriginAllowed("https://memo.chasehuh.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });
});

describe("authorizeNoteRoom", () => {
  it("admits the owner", async () => {
    const result = await authorizeNoteRoom(deps());
    expect(result).toEqual({ status: "ok", userId: "user_1" });
  });

  it("rejects a missing token without hitting the database", async () => {
    const input = deps({ token: "  " });
    const result = await authorizeNoteRoom(input);
    expect(result).toMatchObject({ status: "unauthenticated" });
    expect(input.resolveOwnedNoteId).not.toHaveBeenCalled();
  });

  it("rejects a token the verifier throws on", async () => {
    const input = deps({
      verifyToken: vi.fn(async () => {
        throw new Error("jwt expired");
      }),
    });
    const result = await authorizeNoteRoom(input);
    expect(result).toMatchObject({
      status: "unauthenticated",
      reason: "invalid_token",
    });
    expect(input.resolveOwnedNoteId).not.toHaveBeenCalled();
  });

  it("rejects a verified token with no subject", async () => {
    const result = await authorizeNoteRoom(
      deps({ verifyToken: vi.fn(async () => ({ sub: null })) }),
    );
    expect(result).toMatchObject({ status: "unauthenticated" });
  });

  it("refuses another user's room even with a valid token", async () => {
    // The whole point of the per-document re-check.
    const input = deps({ documentName: OTHER_NOTE_ID });
    const result = await authorizeNoteRoom(input);
    expect(result).toMatchObject({ status: "forbidden", reason: "not_owner" });
    expect(input.resolveOwnedNoteId).toHaveBeenCalledWith(
      "user_1",
      OTHER_NOTE_ID,
    );
  });

  it("refuses a valid token from a different user", async () => {
    const result = await authorizeNoteRoom(
      deps({ verifyToken: vi.fn(async () => ({ sub: "user_2" })) }),
    );
    expect(result).toMatchObject({ status: "forbidden", reason: "not_owner" });
  });

  it("refuses an alias so one note never opens two rooms", async () => {
    const result = await authorizeNoteRoom(
      deps({
        documentName: "aBcdEfGhJkm",
        resolveOwnedNoteId: vi.fn(async () => NOTE_ID),
      }),
    );
    expect(result).toMatchObject({
      status: "forbidden",
      reason: "not_canonical_id",
    });
  });

  it("fails closed when the ownership lookup errors", async () => {
    const result = await authorizeNoteRoom(
      deps({
        resolveOwnedNoteId: vi.fn(async () => {
          throw new Error("db down");
        }),
      }),
    );
    expect(result).toMatchObject({
      status: "forbidden",
      reason: "ownership_lookup_failed",
    });
  });

  it("rejects a disallowed origin before verifying anything", async () => {
    const input = deps({
      origin: "https://evil.example",
      allowedOrigins: ["https://memo.chasehuh.com"],
    });
    const result = await authorizeNoteRoom(input);
    expect(result).toMatchObject({
      status: "forbidden",
      reason: "origin_not_allowed",
    });
    expect(input.verifyToken).not.toHaveBeenCalled();
  });

  it("rejects an empty document name", async () => {
    const result = await authorizeNoteRoom(deps({ documentName: "" }));
    expect(result).toMatchObject({ status: "forbidden" });
  });
});

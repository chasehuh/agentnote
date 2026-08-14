import { describe, expect, it } from "vitest";
import { imageTypeForFile, uploadFailureMessage } from "./paste-images";

describe("imageTypeForFile", () => {
  it("trusts a declared image type", () => {
    expect(imageTypeForFile({ name: "shot.png", type: "image/png" })).toBe(
      "image/png",
    );
  });

  it("normalizes case and charset parameters", () => {
    expect(
      imageTypeForFile({ name: "shot.png", type: "IMAGE/PNG; charset=binary" }),
    ).toBe("image/png");
  });

  it("rejects a declared non-image type", () => {
    expect(imageTypeForFile({ name: "notes.txt", type: "text/plain" })).toBe(
      null,
    );
  });

  it("does not sniff when a non-image type is declared", () => {
    // A `.png` name on a text/plain drop is a lie the extension must not undo.
    expect(imageTypeForFile({ name: "shot.png", type: "text/plain" })).toBe(
      null,
    );
  });

  // The Finder case: drops arrive with an empty type.
  it.each([
    ["shot.png", "image/png"],
    ["shot.jpg", "image/jpeg"],
    ["shot.jpeg", "image/jpeg"],
    ["shot.gif", "image/gif"],
    ["shot.webp", "image/webp"],
    ["shot.avif", "image/avif"],
  ])("sniffs %s from an empty MIME", (name, expected) => {
    expect(imageTypeForFile({ name, type: "" })).toBe(expected);
  });

  it("sniffs case-insensitively and through dotted names", () => {
    expect(imageTypeForFile({ name: "Screenshot 2026-08-14.PNG", type: "" })).toBe(
      "image/png",
    );
  });

  it("rejects an empty MIME with a non-image extension", () => {
    expect(imageTypeForFile({ name: "notes.txt", type: "" })).toBe(null);
  });

  it("rejects an empty MIME with no extension", () => {
    expect(imageTypeForFile({ name: "Screenshot", type: "" })).toBe(null);
  });
});

describe("uploadFailureMessage", () => {
  it("reads as a single failure for a single file", () => {
    expect(uploadFailureMessage(1, 1, "Media upload is not configured")).toBe(
      "Image upload failed: Media upload is not configured",
    );
  });

  it("omits an absent detail", () => {
    expect(uploadFailureMessage(1, 1, null)).toBe("Image upload failed");
  });

  it("names the survivors in a partly failed batch", () => {
    expect(uploadFailureMessage(1, 3, "Image too large")).toBe(
      "1 of the dropped images failed to upload: Image too large",
    );
    expect(uploadFailureMessage(2, 3, "Image too large")).toBe(
      "2 of 3 images failed to upload: Image too large",
    );
  });
});

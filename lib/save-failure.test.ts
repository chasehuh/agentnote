import { describe, expect, it } from "vitest";
import {
  SAVE_RETRY_BACKOFF_MS,
  classifySaveHttpStatus,
  hasUnsavedWork,
  isCurrentSaveAttempt,
  nextRetryDelayMs,
} from "./save-failure";

describe("nextRetryDelayMs", () => {
  it("returns capped backoff then null", () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(3)).toBe(8000);
    expect(nextRetryDelayMs(4)).toBeNull();
    expect(nextRetryDelayMs(-1)).toBeNull();
    expect(SAVE_RETRY_BACKOFF_MS).toHaveLength(4);
  });
});

describe("classifySaveHttpStatus", () => {
  it("distinguishes ok, auth, and generic failures", () => {
    expect(classifySaveHttpStatus(200)).toBe("ok");
    expect(classifySaveHttpStatus(204)).toBe("ok");
    expect(classifySaveHttpStatus(401)).toBe("auth");
    expect(classifySaveHttpStatus(500)).toBe("generic");
    expect(classifySaveHttpStatus(404)).toBe("generic");
  });
});

describe("hasUnsavedWork", () => {
  it("is true for dirty, saving, and error", () => {
    expect(hasUnsavedWork("dirty")).toBe(true);
    expect(hasUnsavedWork("saving")).toBe(true);
    expect(hasUnsavedWork("error")).toBe(true);
    expect(hasUnsavedWork("saved")).toBe(false);
  });
});

describe("isCurrentSaveAttempt", () => {
  it("drops stale sequences so older retries cannot commit", () => {
    expect(isCurrentSaveAttempt(3, 3)).toBe(true);
    expect(isCurrentSaveAttempt(2, 3)).toBe(false);
    expect(isCurrentSaveAttempt(4, 3)).toBe(false);
  });
});

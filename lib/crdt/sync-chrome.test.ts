import { describe, expect, it } from "vitest";
import { crdtSyncChrome } from "./sync-chrome";

describe("crdtSyncChrome", () => {
  it("shows nothing once the note is synced", () => {
    expect(crdtSyncChrome("synced")).toBeNull();
  });

  it("labels an unreachable server as Offline, with a retry", () => {
    const chrome = crdtSyncChrome("offline");
    expect(chrome?.label).toBe("Offline");
    expect(chrome?.retry).toBe(true);
    // Copy must keep saying the work is safe on this device.
    expect(chrome?.title).toContain("Saved on this device");
  });

  it("reports loading and syncing as Syncing…, never Saved (#75 residual)", () => {
    for (const status of ["loading", "syncing"] as const) {
      const chrome = crdtSyncChrome(status);
      expect(chrome?.label).toBe("Syncing…");
      expect(chrome?.label).not.toContain("Saved");
      // Nothing to flush yet — a retry button here would be a no-op.
      expect(chrome?.retry).toBe(false);
    }
  });
});

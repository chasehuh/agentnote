"use client";

import { useEffect, useState } from "react";

const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
const POLL_MS = 60_000;

type ReloadToUpdateProps = {
  /** When true, flush pending work and/or warn before reloading. */
  hasUnsavedWork?: boolean;
  /** Best-effort flush of the current buffer before reload. */
  onFlushSave?: () => Promise<boolean>;
};

export function ReloadToUpdate({
  hasUnsavedWork = false,
  onFlushSave,
}: ReloadToUpdateProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (
          !cancelled &&
          data.buildId &&
          data.buildId !== CLIENT_BUILD_ID
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        // Ignore network blips — next poll will retry.
      }
    }

    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateAvailable || dismissed) return null;

  async function handleReload() {
    if (busy) return;
    setBusy(true);
    try {
      if (hasUnsavedWork) {
        let flushed = false;
        if (onFlushSave) {
          try {
            flushed = await onFlushSave();
          } catch {
            flushed = false;
          }
        }
        if (!flushed) {
          const proceed = window.confirm(
            "You have unsaved changes. Reload anyway and discard them?",
          );
          if (!proceed) return;
        }
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="zed-update">
      <button
        type="button"
        className="zed-update__btn"
        title="A newer version of agentnote is available"
        disabled={busy}
        onClick={() => void handleReload()}
      >
        <DownloadIcon />
        Reload to Update
      </button>
      <button
        type="button"
        className="zed-update__dismiss"
        aria-label="Dismiss update"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 2.5v7m0 0L5.5 7M8 9.5 10.5 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

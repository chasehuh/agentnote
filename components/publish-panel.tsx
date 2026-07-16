"use client";

import { useEffect, useState } from "react";
import type { Note } from "@/lib/types";
import { publicNotePath } from "@/lib/public-id";

export function PublishPanel({
  open,
  note,
  onClose,
  onNoteChange,
}: {
  open: boolean;
  note: Note | null;
  onClose: () => void;
  onNoteChange: (note: Note) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !note) return null;

  const publicUrl = note.is_public
    ? `${window.location.origin}${publicNotePath(note.id, note.author_handle)}`
    : "";

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${note!.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("Failed to publish");
      const data = (await res.json()) as { note: Note };
      onNoteChange(data.note);
    } catch {
      setError("Couldn’t publish this note");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${note!.id}/publish`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unpublish");
      const data = (await res.json()) as { note: Note };
      onNoteChange(data.note);
      setCopied(false);
    } catch {
      setError("Couldn’t unpublish this note");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setError("Couldn’t copy the link");
    }
  }

  return (
    <div className="agentnote-settings-root" onClick={onClose} role="presentation">
      <div
        className="zed-dialog zed-publish"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zed-publish-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="zed-publish-title" className="zed-dialog__title">
          Publish note
        </h2>
        <p className="zed-dialog__desc">
          Anyone with the link can view this note. They won’t be able to edit
          it.
        </p>

        {note.is_public && publicUrl ? (
          <>
            <div className="zed-publish__link-row">
              <input
                className="zed-field zed-publish__field"
                readOnly
                value={publicUrl}
                aria-label="Public link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="zed-btn zed-btn-primary"
                onClick={() => void copyLink()}
                disabled={busy}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="zed-publish__status">
              This note is public. Unpublish anytime to revoke the link.
            </p>
            <div className="zed-dialog__row">
              <button
                type="button"
                className="zed-btn"
                onClick={() => void unpublish()}
                disabled={busy}
              >
                Unpublish
              </button>
              <button
                type="button"
                className="zed-btn zed-btn-primary"
                onClick={onClose}
                disabled={busy}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="zed-publish__status">
              This note is private. Only you can open it while signed in.
            </p>
            <div className="zed-dialog__row">
              <button
                type="button"
                className="zed-btn"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="zed-btn zed-btn-primary"
                onClick={() => void publish()}
                disabled={busy}
              >
                {busy ? "Publishing…" : "Publish"}
              </button>
            </div>
          </>
        )}

        {error ? <p className="zed-dialog__error">{error}</p> : null}
      </div>
    </div>
  );
}

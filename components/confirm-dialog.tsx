"use client";

import { useEffect } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="agentnote-settings-root"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="zed-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zed-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="zed-confirm-title" className="zed-dialog__title">
          {title}
        </h2>
        <p className="zed-dialog__desc">{description}</p>
        <div className="zed-dialog__row zed-confirm__actions">
          <button
            type="button"
            className="zed-btn"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "zed-btn zed-btn-danger" : "zed-btn zed-btn-primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import type { MarkdownImage } from "@/lib/media";

const DEFAULT_PREVIEW_WIDTH = 480;
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;

export function ResizableImagePreview({
  image,
  onWidthChange,
}: {
  image: MarkdownImage;
  onWidthChange: (width: number) => void;
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const width = draftWidth ?? image.width ?? DEFAULT_PREVIEW_WIDTH;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      startRef.current = { x: event.clientX, width };
      setDraftWidth(width);

      const onMove = (moveEvent: PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        const next = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, start.width + (moveEvent.clientX - start.x)),
        );
        setDraftWidth(next);
      };

      const onUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        const start = startRef.current;
        startRef.current = null;
        if (!start) return;
        const next = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, start.width + (upEvent.clientX - start.x)),
        );
        setDraftWidth(null);
        onWidthChange(next);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [onWidthChange, width],
  );

  return (
    <div className="zed-image-previews__item" style={{ width }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.alt || ""} draggable={false} />
      <button
        type="button"
        className="zed-image-previews__handle"
        aria-label="Resize image"
        title={`${Math.round(width)}px — drag to resize`}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}

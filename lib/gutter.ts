/**
 * Measure how many visual rows each hard line occupies in a wrapped textarea.
 * Returns one entry per `\n`-separated line (empty document → [1]).
 */
export function measureWrappedRowCounts(
  textarea: HTMLTextAreaElement,
  text: string,
): number[] {
  const lines = text.split("\n");
  if (lines.length === 0) return [1];

  const style = window.getComputedStyle(textarea);
  const lineHeightPx = parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
    return lines.map(() => 1);
  }

  // Content-box width available for text (exclude horizontal padding).
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const contentWidth = Math.max(
    0,
    textarea.clientWidth - paddingLeft - paddingRight,
  );
  if (contentWidth <= 0) {
    return lines.map(() => 1);
  }

  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    height: "auto",
    width: `${contentWidth}px`,
    top: "0",
    left: "-99999px",
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    font: style.font,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    tabSize: style.tabSize,
    boxSizing: "content-box",
    padding: "0",
    border: "0",
    margin: "0",
  } as Partial<CSSStyleDeclaration>);

  document.body.appendChild(mirror);

  try {
    return lines.map((line) => {
      // Preserve trailing spaces / empty lines the same way pre-wrap does.
      mirror.textContent = line.length === 0 ? "\u00a0" : line;
      const rows = Math.max(1, Math.round(mirror.offsetHeight / lineHeightPx));
      return rows;
    });
  } finally {
    mirror.remove();
  }
}

export function unitRowCounts(lineCount: number): number[] {
  return Array.from({ length: Math.max(1, lineCount) }, () => 1);
}

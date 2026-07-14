/** ASCII `->` → Unicode arrow. Browsers skip font `calt` in Hangul runs. */
const ASCII_ARROW = "->";
const UNICODE_ARROW = "\u2192"; // →

export function substituteAsciiArrows(
  text: string,
  caret = text.length,
): { text: string; caret: number } {
  if (!text.includes(ASCII_ARROW)) {
    return { text, caret };
  }

  let newCaret = caret;
  let i = 0;
  let replacementsBefore = 0;

  while (i < text.length) {
    if (text[i] === "-" && text[i + 1] === ">") {
      const end = i + 2;
      if (end <= caret) {
        newCaret -= 1;
      } else if (i < caret && caret < end) {
        newCaret = i - replacementsBefore + 1;
      }
      replacementsBefore += 1;
      i = end;
      continue;
    }
    i += 1;
  }

  return {
    text: text.replaceAll(ASCII_ARROW, UNICODE_ARROW),
    caret: Math.max(0, Math.min(newCaret, text.length - replacementsBefore)),
  };
}

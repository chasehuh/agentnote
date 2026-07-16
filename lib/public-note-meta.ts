export function previewPublicTitle(title: string, body: string) {
  const fromTitle = title.trim();
  if (fromTitle) return fromTitle;
  const firstLine = body.split("\n").find((line) => line.trim());
  return firstLine?.trim() || "Untitled";
}

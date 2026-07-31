/** Sidebar / tab title = first non-empty body line. Client and server must agree. */
export function deriveNoteTitle(body: string): string {
  return (
    body.split("\n").find((line) => line.trim())?.trim().slice(0, 120) ?? ""
  );
}

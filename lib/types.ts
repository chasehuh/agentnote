export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  /**
   * Soft-delete timestamp. Null = live note.
   * Non-null = Archived (Recently Deleted); purged after retention.
   */
  deleted_at: string | null;
  /**
   * Owning note. Set only when this note was CREATED from inside another note
   * (`[[` create / `/` New note); null = root. A Markdown link to a note never
   * sets this — hierarchy is a create-time edge, not a parse of the body.
   */
  parent_id: string | null;
  /**
   * Manual sidebar rank among siblings (lower = higher in the list). Owned by
   * the server: a create takes `min(siblings) - 1` so it lands on top, and a
   * drag rewrites the whole sibling group to `1..n`. Never bumped by an edit —
   * the sidebar is not a recency list (see lib/note-order.ts).
   */
  sort_order: number;
  /** True when a public `/p/...` link is live. */
  is_public: boolean;
  /**
   * Share lookup key — same as `id` (Meet-style) when published.
   * Older rows may still hold a legacy opaque token until republished.
   */
  public_id: string | null;
  published_at: string | null;
  /** Creator handle stamped at publish (for `/p/{handle}/{id}`). */
  author_handle: string | null;
};

/** Anonymous payload for published notes (no owner user id). */
export type PublicNote = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  updated_at: string;
  author_handle: string | null;
  public_id: string;
};

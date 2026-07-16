export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
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

export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** True when a public `/p/...` link is live. */
  is_public: boolean;
  /** Unguessable share token; null when unpublished / never published. */
  public_id: string | null;
  published_at: string | null;
  /** Creator handle stamped at publish (for `/p/{handle}/{token}`). */
  author_handle: string | null;
};

/** Anonymous payload for published notes (no owner / private id). */
export type PublicNote = {
  title: string;
  body: string;
  published_at: string;
  updated_at: string;
  author_handle: string | null;
  public_id: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** True when a public `/p/{public_id}` link is live. */
  is_public: boolean;
  /** Unguessable share token; null when unpublished / never published. */
  public_id: string | null;
  published_at: string | null;
};

/** Anonymous payload for published notes (no owner / private id). */
export type PublicNote = {
  title: string;
  body: string;
  published_at: string;
  updated_at: string;
};

# agentnote

Minimal notepad built to sit next to the agent tab.

Live: [memo.chasehuh.com](https://memo.chasehuh.com)

## Stack

- Next.js (App Router) + `proxy.ts` (Next 16)
- Clerk (`agentnote` app) with **GitHub OAuth** sign-in
- CodeMirror 6 note editor (Zed-like chrome, soft wrap, Tab→spaces, Tab indents Markdown list markers; ⌘⌫ deletes to hard line start, ⇧⌘K deletes the line)
- Postgres (`pg`) — notes scoped by Clerk `user_id`
- Optional Yjs CRDT note body (`NEXT_PUBLIC_AGENTNOTE_CRDT`, see below)
- Vercel

## Setup

```bash
pnpm install
cp .env.example .env.local
```

### Clerk application

Use a dedicated Clerk application named **`agentnote`** (do **not** attach this project to sume.com / sume.so Clerk apps).

```bash
# Link the existing agentnote app and pull keys into .env.local
clerk link --app <app_id>
clerk env pull

# Development: enable GitHub with Clerk shared credentials
clerk config patch --json '{"connection_oauth_github":{"enabled":true}}' --yes
```

Required env (see `.env.example`):

```bash
DATABASE_URL=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/login
```

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with GitHub.

When media env vars are set, pasting or dropping an image uploads it (Clerk-authenticated) under a preferred key prefix `agentnote/{userId}/…` and inserts `![alt](url)` Markdown at the caret. CodeMirror renders that mark as an inline preview under the source line (Obsidian Live Preview–style). Drag the corner handle to rewrite Obsidian `|width` syntax (`![alt|480](url)`); double-click the handle to clear the width. The Markdown string remains the only source of truth for body sync and persistence.

### Production GitHub OAuth App (human step)

Development can use Clerk’s shared GitHub credentials. Production needs a GitHub OAuth App:

1. Create an OAuth App at [GitHub Developer Settings](https://github.com/settings/developers) (under `chasehuh` or the operator account).
2. Set **Homepage URL** to `https://memo.chasehuh.com`.
3. Set **Authorization callback URL** to the value shown in the Clerk Dashboard for the **agentnote** production instance → Social connections → GitHub (typically `https://<clerk-frontend-api>/v1/oauth_callback`).
4. Paste Client ID + Client Secret into Clerk production → GitHub connection.
5. Add production domain `memo.chasehuh.com` in Clerk, deploy with production Clerk keys on Vercel.

### Existing notes without `user_id`

Existing rows created before Clerk have no `user_id`. After the first GitHub sign-in, copy your Clerk user id from the Clerk Dashboard (Users) and run:

```sql
UPDATE notes SET user_id = 'user_...' WHERE user_id IS NULL;
ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
```

(`ensureSchema` will set `NOT NULL` automatically once no nulls remain.)

### Archived notes (soft-delete)

Sidebar `×` asks for confirmation, then moves the note to **Archived** (`deleted_at`).

- Restore from the Archived section within **30 days**.
- Delete forever from Archived (second confirm) hard-deletes the row.
- Archiving a published note unpublishes it; restore does not re-publish.
- Nightly Vercel Cron `GET /api/cron/purge-archived` (Bearer `CRON_SECRET`) hard-deletes expired archive rows. Listing Archived also opportunistically purges.

Set on Vercel Production:

```bash
CRON_SECRET=<long-random-string>
```

### Note body revisions (ops recovery)

Every body-changing save stores the **previous** body in `note_revisions` before overwrite. Title-only or identical-body saves write nothing. Autosave bursts coalesce: at most one new revision per note per **60 seconds**. Rows older than **30 days** are hard-purged by nightly cron `GET /api/cron/purge-note-revisions` (Bearer `CRON_SECRET`). Permanent note delete (and the 30-day archive purge) cascade-deletes that note’s revisions.

This is an operator safety net, not a user-facing history UI. It is also **not** a substitute for database backups — enable Railway volume backups (below) for disasters; confirm whether the Postgres provider has point-in-time recovery (PITR) enabled separately.

List recent revisions for a note:

```sql
SELECT id, length(body) AS body_len, created_at
FROM note_revisions
WHERE note_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

Restore a specific revision’s body onto the live note (review `body` first):

```sql
UPDATE notes AS n
SET body = r.body,
    title = r.title,
    updated_at = NOW()
FROM note_revisions AS r
WHERE n.id = r.note_id
  AND r.id = $revision_id
RETURNING n.id, length(n.body) AS body_len, n.updated_at;
```

### CRDT note body (`NEXT_PUBLIC_AGENTNOTE_CRDT`)

Behind `NEXT_PUBLIC_AGENTNOTE_CRDT=1` the note body is a **Yjs `Y.Text`** bound to CodeMirror 6 via `y-codemirror.next`, instead of a whole-document `PUT`. Concurrent edits from any number of tabs or devices merge deterministically, so there is no 409, no discard prompt, and no silent truncation for the body.

`notes.body` stays exactly what it was — a plaintext column — but it is now a **server-derived projection** of the CRDT. Publish/`/p/…`, `note_revisions`, derived titles, archive, and the sidebar preview are unchanged.

Tables (created idempotently by `ensureSchema()`, both `ON DELETE CASCADE` from `notes`):

| Table | Contents |
| --- | --- |
| `note_doc_updates` | Append-only Yjs update log (`seq`, `update_bin`). Never updated in place. |
| `note_doc_snapshots` | One compacted state per CRDT-backed note (`state_bin`, `state_vector`, `through_seq`). Its presence also marks the note as CRDT-managed. |

Endpoints (both Clerk-authenticated, both resolve the id **through `user_id`**):

- `GET /api/notes/:id/doc` — full state; seeds from `notes.body` exactly once per note. Seeding is **server-only** and guarded by `INSERT … ON CONFLICT DO NOTHING` + re-read; seeding twice would duplicate the body on merge.
- `POST /api/notes/:id/doc/sync` — push + pull in one round trip (`{ update, state_vector, since }` in, `{ seq, update, body, updated_at }` out). Appends the update, re-projects `notes.body` under a per-note advisory lock, and returns the diff the caller is missing. Payloads over **1 MiB** decoded are rejected with `413`; an update the server cannot apply is `400` and is **not** appended.

Transport in this phase is the existing HTTP + 1.5 s visible-tab poll, plus a `doc-update` BroadcastChannel message that converges peer tabs in about one frame. No new infrastructure.

Operational notes:

- **The flag is effectively one-way per note.** Once a note has been opened with the flag on, a snapshot row exists and legacy whole-document `PUT`s for it are refused with `409 { "reason": "crdt_managed_body" }`. Turning the flag back off leaves those notes readable and publishable but not body-editable. To un-seed a note, write its projected body back and drop its doc rows:

  ```sql
  DELETE FROM note_doc_updates  WHERE note_id = $1;
  DELETE FROM note_doc_snapshots WHERE note_id = $1;
  ```

  (`notes.body` already holds the current text, so nothing is lost.)
- **Undo/redo moves to `Y.UndoManager`** on CRDT-backed notes — CodeMirror's `history()` is dropped there so ⌘Z does not double-apply. Undo is per-client by design: you undo your own edits, not a peer's.
- **IME safety.** `y-codemirror.next` dispatches remote deltas into CodeMirror with no `view.composing` guard, so inbound updates are held back while an IME composition is active and replayed on `compositionend`. That is lossless: Yjs updates are commutative and idempotent.
- **The update log grows monotonically.** Compaction (fold the tail into the snapshot, then delete folded rows) is a follow-up; until it ships, a heavily edited note accumulates rows.
- **Recovery** is unchanged: `note_revisions` still records the prior body on every projection write, coalesced at 60 s. The CRDT log itself is a second, finer-grained trail — replaying `note_doc_updates` in `seq` order reconstructs any past state.

### Railway Postgres backups (ops)

Product trash recovers user mistakes. Body revisions recover a bad overwrite within the retention window. For disasters (volume wipe / bad restore), enable **daily volume backups** on the Railway Postgres service:

1. Railway → project → Postgres → **Backups** → schedule **Daily**.
2. Optionally create a manual backup after enabling.
3. Restoring a volume backup stages a new volume and rewinds the **entire** database — use for disasters, not single-note recovery ([Railway volume backups](https://docs.railway.com/volumes/backups)).

## Deploy

Point the project at Vercel, set the Clerk + `DATABASE_URL` (+ `CRON_SECRET`) env vars for Production, attach `memo.chasehuh.com`, and complete the production GitHub OAuth App steps above.

## License

[MIT](./LICENSE)

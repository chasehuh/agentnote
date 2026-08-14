# agentnote

Minimal notepad built to sit next to the agent tab.

Live: [memo.chasehuh.com](https://memo.chasehuh.com)

## Stack

- Next.js (App Router) + `proxy.ts` (Next 16)
- Clerk (`agentnote` app) with **GitHub OAuth** sign-in
- CodeMirror 6 note editor (Zed-like chrome, soft wrap, Tab→spaces, Tab indents Markdown list markers; ⌘B bold, ⇧⌘X strikethrough, ⌘⌫ deletes to hard line start, ⇧⌘K deletes the line)
- Postgres (`pg`) — notes scoped by Clerk `user_id`
- Optional Yjs CRDT note body (`NEXT_PUBLIC_AGENTNOTE_CRDT`, see below), with an optional Hocuspocus realtime server on Railway (`services/collab`)
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

### Keyboard

| Key | Action |
| --- | --- |
| `⌘B` / `Ctrl+B` | Toggle `**bold**` around the selection (empty caret inserts `****`) |
| `⇧⌘X` | Toggle `~~strikethrough~~` |
| `⌘⇧B` / `Ctrl+Shift+B`, `⌘\` | Show / hide the notes sidebar |
| `⌘N` | New note (always a root note, and it lands at the top of the list) |
| `⌘⌫` | Delete to hard line start |
| `⇧⌘K` | Delete the line |
| `→` / `←` (on a sidebar note) | Expand / collapse its sub-notes |
| `⌘→` / `⌘←` (in the sidebar) | Expand / collapse the whole note tree. Sidebar-scoped, so `⌘←` / `⌘→` keep their line-boundary meaning in the editor. |

### Sub-notes, wiki links, and tags

Notes link to each other as an Obsidian/Notion-style graph, and the sidebar renders them as a tree in the spirit of [Zed's project panel](https://zed.dev/docs/preview/project-panel).

**Creating from inside a note nests it; linking does not.** This is the whole rule:

| Action | Result |
| --- | --- |
| **Create** from inside a note — `[[Name` → `Create "…"`, or `/` → **New note** with a title | A true **sub-note**: an ordinary note row whose `parent_id` is the note you were writing in. It appears indented under that note in the sidebar, and its link is inserted at your caret. |
| **Link** to an existing note — picking one in `[[`, or `/` → **Link to note** | A peer hyperlink only. Inserts `[Title](/n/{id})` and changes no parentage on either note. |
| `⌘N` / the sidebar `+` | A root note. |

So a body full of `/n/…` links implies no hierarchy at all — the tree comes from where a note was *created*, never from parsing text.

| Type | Result |
| --- | --- |
| `[[` | Note picker. Filters your notes as you type; `Enter` inserts `[Title](/n/{id})`. |
| `[[` + a name that matches nothing | `Create "…"` — creates the sub-note **and** inserts its link, without leaving the note you are writing. |
| `/` (line start or after a space) | Command palette: **New note**, **Link to note**. The word after `/` is the argument, so `/groceries` → New note creates "groceries". |
| `#` | Completes from tags already used across your notes. |

**`[[` is a trigger, never a storage format.** Only standard Markdown is written to the body, so publishing, `note_revisions`, and CRDT sync need no knowledge of any of it. Existing `[label](/n/{id})` links keep working unchanged. Hierarchy lives in the `notes.parent_id` column, not in the note body, so it is likewise invisible to the CRDT.

### Sidebar order

The sidebar is **arranged, not sorted**. It is not a recency list, so editing a note never moves its row.

| Event | Where the row goes |
| --- | --- |
| **New note** (`⌘N`, the sidebar `+`, or `[[` / `/` create) | The **top** of its sibling group — `⌘N` tops the root list, a sub-note tops its parent's children. |
| **Drag a row** onto another row | It lands above or below that row, depending on which half you drop on. |
| **Editing, saving, publishing** | Nowhere. The row refreshes in place. |
| **Restoring from Archived** | Back to the rank it had when it was archived. |

Order lives in the `notes.sort_order` column, so it is per-account and every device agrees. A create takes `min(siblings) - 1`, which is a single-row write; a drag rewrites the whole dragged group to `1..n` through `PUT /api/notes/order`. Reordering deliberately leaves `updated_at` alone — it is not an edit, and bumping it would hand every open editor a false save conflict.

**Drag is sibling-only.** A row only accepts a drop from a note at the same level under the same parent, so dragging never reparents — `parent_id` still means "created inside" and nothing else. Dragging a parent carries its whole subtree, since the tree is flattened depth-first. While a `#tag` filter is active rows are not draggable: that view is a flat search result, not the arrangement. `⌘1`…`⌘9` follow the rendered list, so they follow the arrangement too.

Existing notes were ranked by their `updated_at` at migration time, so the first load after the upgrade looked exactly like the last load before it.

Archiving a parent does not archive or hide its children — they move up to the top level of the sidebar and re-nest when the parent is restored. Permanently deleting a parent promotes its children to the top level (`ON DELETE SET NULL`) rather than deleting them. While a `#tag` filter is active the sidebar is a flat result list, since nesting matches under parents the filter excluded would draw structure the results do not have.

Because the link label is a snapshot of the title at insertion time, renaming a note does not rewrite links that point at it (Notion's behavior, not Obsidian's rename-refactor).

**Tags** are inline `#tag` in the body — `#idea`, `#work/agentnote`. A tag must follow whitespace and contain at least one non-digit, so `# Heading` stays a heading and `#1` stays an issue reference; tags inside fenced code blocks, inline code spans, and link destinations are ignored. Tags are derived from note bodies on the client, so there is no table to migrate and no index to keep in sync. Click a tag in the editor, or a chip in the sidebar, to filter the note list.

When media env vars are set, pasting or dropping an image uploads it (Clerk-authenticated) under a preferred key prefix `agentnote/{userId}/…` and inserts `![alt](url)` Markdown at the caret. CodeMirror renders that mark as an inline preview under the source line (Obsidian Live Preview–style). Drag the corner handle to rewrite Obsidian `|width` syntax (`![alt|480](url)`); double-click the handle to clear the width. The Markdown string remains the only source of truth for body sync and persistence.

Finder drops arrive with an empty `File.type`, so a file whose MIME is missing is classified by extension (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`) instead of being dropped on the floor. A declared non-image type is never overridden by its extension. Each file in a drop uploads independently, so one rejection does not cancel the rest, and any failure raises a self-clearing **Image not uploaded** notice in the titlebar (full reason on hover) rather than only a console error.

`MEDIA_UPLOAD_URL` points at the Cloudflare Worker checked in under [`workers/media-upload/`](workers/media-upload/README.md) — `https://agentnote-media-upload.cw-huh.workers.dev`, backed by the R2 bucket `agentnote-media`. It takes a bearer upload and serves `GET /{key}` publicly. `MEDIA_UPLOAD_SECRET` must match the worker's `UPLOAD_SECRET`, which lives only in Cloudflare and Vercel. Without both vars set, `/api/upload` returns 503 and the editor shows the notice.

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

Two transports sit behind the same document model, chosen by `NEXT_PUBLIC_AGENTNOTE_COLLAB_URL` (see below). Unset: HTTP + a 1.5 s visible-tab poll, no extra infrastructure. Set: a Hocuspocus WebSocket. Either way a `doc-update` BroadcastChannel message converges peer tabs in about one frame.

**Local-first.** Each open note is mirrored into IndexedDB under `agentnote.note.{userId}.{noteId}` (`y-indexeddb`), so a reload or a dropped connection loses nothing. On load the client applies the server state and then pushes back anything the server has never seen — offline edits are reconciled, not just overwritten. Reconnecting (`online`, tab focus, or the next poll) flushes whatever queued. While the server is unreachable the editor stays fully usable and the titlebar shows a muted **Offline** mark (with Retry) to the left of Publish, tooltipped *saved on this device*. A note whose state has not landed yet reads **Syncing…** rather than claiming to be saved. Neither uses the red `.zed-save-error` chrome — that is reserved for real failures on the legacy whole-document path (session expired, conflict), because a CRDT edit is already durable in IndexedDB and nothing is at risk.

Operational notes:

- **Clearing site data drops unsynced offline edits.** Everything that reached the server is safe; anything typed while offline and never flushed lives only in IndexedDB.
- **The flag is effectively one-way per note.** Once a note has been opened with the flag on, a snapshot row exists and legacy whole-document `PUT`s for it are refused with `409 { "reason": "crdt_managed_body" }`. Turning the flag back off leaves those notes readable and publishable but not body-editable. To un-seed a note, write its projected body back and drop its doc rows:

  ```sql
  DELETE FROM note_doc_updates  WHERE note_id = $1;
  DELETE FROM note_doc_snapshots WHERE note_id = $1;
  ```

  (`notes.body` already holds the current text, so nothing is lost.)
- **Undo/redo moves to `Y.UndoManager`** on CRDT-backed notes — CodeMirror's `history()` is dropped there so ⌘Z does not double-apply. Undo is per-client by design: you undo your own edits, not a peer's.
- **IME safety.** `y-codemirror.next` dispatches remote deltas into CodeMirror with no `view.composing` guard, so inbound updates are held back while an IME composition is active and replayed on `compositionend`. That is lossless: Yjs updates are commutative and idempotent.
- **Compaction.** The update log is append-only, so nightly cron `GET /api/cron/compact-note-docs` (Bearer `CRON_SECRET`) folds each note's tail back into its snapshot and deletes the folded rows. A note qualifies past **200 updates** or **256 KiB** of tail (the size guard stops one runaway note growing unbounded); at most **100 notes** are compacted per run and the response reports `truncated` when more were waiting. Compaction is a full `Y.Doc` load and re-encode, not `Y.mergeUpdates` — merging alone does not garbage-collect deleted content, so a heavily edited note would never actually shrink. `through_seq` only ever moves forward.
- **Recovery** is unchanged: `note_revisions` still records the prior body on every projection write, coalesced at 60 s. The CRDT log itself is a second, finer-grained trail — replaying `note_doc_updates` in `seq` order reconstructs any past state.

### Realtime transport (`NEXT_PUBLIC_AGENTNOTE_COLLAB_URL`)

Setting `NEXT_PUBLIC_AGENTNOTE_COLLAB_URL` swaps the poll for a WebSocket and drops cross-device latency from ~1.5 s to well under 100 ms. Leaving it unset keeps the HTTP transport exactly as it was, so rolling realtime back is one variable — the document model, schema, and editor binding are identical either way.

Production: `wss://agentnote-collab-production.up.railway.app`

**The server** lives in `services/collab` (`@agentnote/collab`) — a Hocuspocus process deployed as a second service in the same Railway project as the Postgres, so it reaches the database over the private network. One room per note, keyed by the note's **canonical** id.

| Env | Purpose |
| --- | --- |
| `DATABASE_URL` | Railway reference to the Postgres service. |
| `CLERK_SECRET_KEY` | Verifies session tokens. Must match the Clerk instance the app runs against — a production server cannot verify development tokens. |
| `AGENTNOTE_ALLOWED_ORIGINS` | Optional comma-separated origin allowlist. Unset means any origin, which is still gated by the token and ownership checks. |
| `PORT` | Injected by Railway. |

`onAuthenticate` verifies the Clerk JWT **and** re-checks ownership for that specific `documentName`, so a valid token for user A cannot open user B's room. It also refuses an alias, because two room keys for one note would mean two in-memory documents reconciling only through Postgres. `GET /health` is the Railway health check.

Persistence reuses the same helpers the HTTP transport writes to, so there is exactly one document history. `fetch` returns snapshot + tail (seeding from `notes.body` once); `store` — debounced to at most every 2 s, at least every 10 s — **merges** the room state with whatever the log holds rather than replacing it, snapshots the result, drops the folded tail, and re-projects `notes.body`. An HTTP client appending while a room is live therefore cannot be clobbered.

**The client** gives the provider its own `Y.Doc` and bridges it to the editor's, rather than handing the editor document straight to Hocuspocus. That is what keeps the IME gate in the path: the provider applies updates the moment they arrive, and `y-codemirror.next` would dispatch them into CodeMirror mid-composition. Mirroring both ways is safe for the usual reason — Yjs updates are commutative and idempotent.

Local development:

```bash
pnpm collab:dev                                   # ws://localhost:1234
NEXT_PUBLIC_AGENTNOTE_COLLAB_URL=ws://localhost:1234 pnpm dev
```

Operational notes:

- **Preview deployments are blocked by the allowlist.** Production is pinned to `https://www.agentnote.dev,https://agentnote.dev,https://memo.chasehuh.com` — the live origin is `https://www.agentnote.dev`, and the other two redirect to it. To exercise realtime from a Vercel preview, add that origin to `AGENTNOTE_ALLOWED_ORIGINS` or clear the variable.
- **A note this device has never opened needs the socket.** The editor mounts on the CRDT document, and on this transport that document only arrives over the WebSocket — a note with no IndexedDB copy stays read-only (showing the last projected `notes.body`) until the socket connects. Notes this device has already opened stay fully editable offline and flush on reconnect.
- **Remote cursors stay off.** The editor keeps its own awareness and the provider runs with `awareness: null`; wiring presence across the bridge is Phase 3 work.
- **A note's sidebar row** refreshes from the existing notes-list poll on this path — the realtime server writes `notes.body` on its own debounce rather than answering each edit.

### Railway Postgres backups (ops)

Product trash recovers user mistakes. Body revisions recover a bad overwrite within the retention window. For disasters (volume wipe / bad restore), enable **daily volume backups** on the Railway Postgres service:

1. Railway → project → Postgres → **Backups** → schedule **Daily**.
2. Optionally create a manual backup after enabling.
3. Restoring a volume backup stages a new volume and rewinds the **entire** database — use for disasters, not single-note recovery ([Railway volume backups](https://docs.railway.com/volumes/backups)).

## Deploy

Point the project at Vercel, set the Clerk + `DATABASE_URL` (+ `CRON_SECRET`) env vars for Production, attach `memo.chasehuh.com`, and complete the production GitHub OAuth App steps above.

## License

[MIT](./LICENSE)

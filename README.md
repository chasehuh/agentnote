# agentnote

Minimal notepad built to sit next to the agent tab.

Live: [memo.chasehuh.com](https://memo.chasehuh.com)

## Stack

- Next.js (App Router) + `proxy.ts` (Next 16)
- Clerk (`agentnote` app) with **GitHub OAuth** sign-in
- CodeMirror 6 note editor (Zed-like chrome, soft wrap, Tab→spaces, Tab indents Markdown list markers; ⌘⌫ deletes to hard line start, ⇧⌘K deletes the line)
- Postgres (`pg`) — notes scoped by Clerk `user_id`
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

### Railway Postgres backups (ops)

Product trash recovers user mistakes. For disasters (volume wipe / bad restore), enable **daily volume backups** on the Railway Postgres service:

1. Railway → project → Postgres → **Backups** → schedule **Daily**.
2. Optionally create a manual backup after enabling.
3. Restoring a volume backup stages a new volume and rewinds the **entire** database — use for disasters, not single-note recovery ([Railway volume backups](https://docs.railway.com/volumes/backups)).

## Deploy

Point the project at Vercel, set the Clerk + `DATABASE_URL` (+ `CRON_SECRET`) env vars for Production, attach `memo.chasehuh.com`, and complete the production GitHub OAuth App steps above.

## License

[MIT](./LICENSE)

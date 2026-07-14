# memo

Minimal password-gated notes app with multi-device sync.

Live: [memo.chasehuh.com](https://memo.chasehuh.com)

## Stack

- Next.js (App Router)
- CodeMirror 6 note editor (Zed-like chrome, soft wrap, Tab→spaces)
- Postgres (`pg`)
- Vercel + env-based auth gate

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `MEMO_PASSWORD` | Login password |
| `MEMO_SECRET` | HMAC secret for session cookies |
| `MEDIA_UPLOAD_URL` | (optional) Upload worker URL for pasted/dropped images |
| `MEDIA_UPLOAD_SECRET` | (optional) Shared bearer secret for the upload worker |

When media env vars are set, pasting or dropping an image uploads it and inserts `![alt](url)` Markdown at the caret. CodeMirror renders that mark as an inline preview under the source line (Obsidian Live Preview–style). Drag the corner handle to rewrite Obsidian `|width` syntax (`![alt|480](url)`); double-click the handle to clear the width. The Markdown string remains the only source of truth for body sync and persistence.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Point the project at Vercel (or similar), set the same three env vars for Production, and attach a domain if you want.

## License

[MIT](./LICENSE)

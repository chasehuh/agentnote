# agentnote-media-upload

Cloudflare Worker behind `MEDIA_UPLOAD_URL`. It is the storage half of image
paste/drop: the Next app authenticates the user at `POST /api/upload`, then
`lib/media.ts` forwards the bytes here with a shared bearer secret.

Deployed at `https://agentnote-media-upload.cw-huh.workers.dev`, backed by the
R2 bucket `agentnote-media`.

## Contract

`POST /`

| | |
| --- | --- |
| `Authorization` | `Bearer <UPLOAD_SECRET>` — anything else is `401` |
| `Content-Type` | one of `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif` — anything else is `415` |
| `X-Upload-Id` | optional; used to build the key when `X-Upload-Key` is absent |
| `X-Upload-Key` | optional preferred key; ignored if it is absolute or contains `..` |
| body | raw image bytes, 1 B – 12 MB (`400` / `413` outside that) |

Responds `201 {"url","key"}`, which is the shape `uploadImageBytes` expects.

`GET /{key}` (and `HEAD`) serves the object publicly with a one-year immutable
`cache-control`, so the `![alt](url)` Markdown in a note renders without any
signing. There is no public `LIST`, and keys carry a UUID, so an object is only
reachable by someone who has the URL.

Uploads are bearer-gated but not per-user: the Next route is the auth boundary,
and it namespaces keys as `agentnote/{userId}/…`.

## Deploy

Wrangler is not a repo dependency — this worker deploys on its own cadence.

```sh
cd workers/media-upload
npx wrangler deploy --profile chasehuh   # or: CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
```

The account is not in `wrangler.toml`; supply it with `--profile` (a profile
configured via `wrangler login`) or `CLOUDFLARE_ACCOUNT_ID`.

## Secret

`UPLOAD_SECRET` lives only in Cloudflare and in the Vercel project — never in
this repo:

```sh
npx wrangler secret put UPLOAD_SECRET   # paste the value; it is not echoed
```

The same value must be `MEDIA_UPLOAD_SECRET` on Vercel. Rotating means setting
both, in that order (the worker accepts only one secret at a time, so expect a
short window of `401`s).

## Typecheck (optional)

The root `tsconfig.json` excludes `workers/` because these files use Cloudflare
runtime globals, not DOM/Node ones. To check them locally:

```sh
cd workers/media-upload
npm i --no-save typescript @cloudflare/workers-types && npx tsc -p .
```

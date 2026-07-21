# AGENTS.md

Guidance for AI coding agents working on **apple-music-cleaner**.

## What this project does

Bulk-clean an Apple Music library via the private `amp-api.music.apple.com` web-player API. Two main flows:

1. **Favorites** — remove favorite ratings (`value: 1`) from tracks
2. **Wipe** — delete playlists, albums, music videos, songs, and all ratings

Also ships a local web UI (`npm run web`) that relays API calls through a tiny Node server (origin header requirement).

## Setup

```sh
npm install
cp .env.example .env   # paste AMC_DEV_TOKEN and AMC_MEDIA_USER_TOKEN
npm run typecheck
```

Tokens come from DevTools on music.apple.com (see README). Never commit `.env`.

## Key modules

| File | Role |
|------|------|
| `src/client.ts` | HTTP client, pagination, retries |
| `src/favorites.ts` | Discover favorited tracks |
| `src/history.ts` | Recent-played tracks feed |
| `src/rules.ts` | Selective cleanup rules |
| `src/remove.ts` | Delete favorite ratings |
| `src/wipe.ts` | Full library inventory and deletion |
| `src/cli.ts` | CLI entry point |
| `src/server.ts` | Web app API + static UI |

## Conventions

- TypeScript ESM (`"type": "module"`), run with `tsx`
- CLI defaults to **dry run**; destructive ops need `--execute`
- Deletions run in chunks of 5 parallel requests
- Match existing code style: minimal deps, no test framework yet

## Safe changes

- Add cleanup rules in `src/rules.ts`, wire flags in `src/cli.ts`
- Extend `AppleMusicClient` only when new HTTP patterns are needed
- Update README FAQ and `llms.txt` when user-facing behavior changes

## Do not

- Persist or log user tokens
- Remove dry-run defaults from CLI without explicit user request
- Add heavy dependencies for small features

# AGENTS.md

Guidance for AI coding agents working on **apple-music-cleaner**.

## What this project does

Bulk-clean an Apple Music library via the private `amp-api.music.apple.com` web-player API. Flows:

1. **Selective cleanup** — presets + rules (play activity, dateAdded, duplicates, orphans, heavy rotation)
2. **Favorites / dislikes** — remove ratings with optional filters
3. **Wipe** — delete library items and/or clear ratings (scoped, exclude purchased)
4. **Empty playlists** — delete zero-track playlists
5. **Snapshots & resume** — before/after inventory, retry failure logs

Local web UI (`npm run web`) relays API calls through Node (origin header).

## Setup

```sh
npm install
cp .env.example .env
npm run typecheck
```

Never commit `.env`. Tokens from music.apple.com DevTools (see README).

## Key modules

| File | Role |
|------|------|
| `src/client.ts` | HTTP client, pagination, retries |
| `src/favorites.ts` | Discover favorited/disliked tracks |
| `src/history.ts` | Recent-played feed |
| `src/library-meta.ts` | dateAdded, recently-added, album ids |
| `src/heavy-rotation.ts` | Heavy-rotation feed |
| `src/library-clean.ts` | Duplicates, orphans, empty playlists |
| `src/rules.ts` | Rule engine with per-track reasons |
| `src/cleanup-context.ts` | Lazy-load API context for rules |
| `src/cleanup-runner.ts` | Shared rated-track cleanup |
| `src/presets.ts` | Built-in named presets |
| `src/snapshot.ts` | Inventory snapshots |
| `src/failure-log.ts` | Failure JSON + resume |
| `src/token-info.ts` | JWT expiry inspection |
| `src/cli.ts` / `src/server.ts` | CLI and web API |

## Conventions

- TypeScript ESM, run with `tsx`
- CLI dry-run by default; `--execute` or `AMC_EXECUTE=1` for cron
- Deletions in chunks of 5 parallel requests
- Atomic commits by feature area

## Safe changes

- Add rules in `src/rules.ts` + wire flags in `src/cli.ts` and `src/server.ts`
- Add presets in `src/presets.ts`
- Update README, `llms.txt`, and docs when behavior changes

## Do not

- Persist or log user tokens
- Remove dry-run defaults without explicit request

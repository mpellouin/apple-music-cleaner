# Mac Music.app library database (Tier D)

On macOS, the Music app stores play counts and last-played dates in a local SQLite database. This is richer than the web-player API feed, but **only works on a Mac** with Music.app installed.

## Location

```text
~/Music/Music/Music Library.musiclibrary
```

The library is a package directory. The SQLite file is typically:

```text
~/Music/Music/Music Library.musiclibrary/Library.musiclibrary
```

> Paths vary by macOS version and whether "Sync Library" is enabled. Use Finder → Go → Go to Folder if needed.

## What you can query

| Field | Use |
|---|---|
| `last played date` | True stale-track detection beyond API limits |
| `play count` | Remove favorites with play count = 0 |
| `date added` | Cross-check against API `dateAdded` |

Apple does not document this schema. Community tools (TuneTrack, export scripts) reverse-engineer table names like `ZTRACK` / `ZPLAYCOUNT`.

## Suggested workflow

1. Run `npm start -- probe-history` and `probe-added` via this tool (API path).
2. If the API feed is too shallow, export play counts from Music.app on Mac.
3. Build a keep-list CSV and pass `--keep-file` to protect tracks.
4. Use `--export targets.csv` before any `--execute` run.

## Safety

- **Copy the `.musiclibrary` bundle before experimenting** — corruption breaks Music.app.
- This tool does **not** read the Mac database directly (cross-platform constraint). A future optional `mac-sync` subcommand could ingest an exported CSV.

## Related

- [AppleScript & Shortcuts](./applescript.md) — trigger cleanup from macOS automations
- [Recommendations reset](./recommendations-reset.md) — reset taste profile after a wipe

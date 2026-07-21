# 🧹 apple-music-cleaner

Bulk-remove your favorited tracks from Apple Music — or wipe your whole library — using the same private API the [music.apple.com](https://music.apple.com) web player talks to. No paid Apple Developer account required.

Comes in two flavors, sharing one engine:

- **Web app** — `npm run web`, open `localhost:3000`, paste two tokens, click. It shows your library and does the deleting for you, with a live progress bar.
- **CLI** — same operations from the terminal, dry-run by default.

<p align="center"><em>Un-favorite everything. Or wipe it all.</em></p>

---

## Run this at your own risk

This tool works by using your own web-player session tokens to call a **private, undocumented Apple API** — the same one music.apple.com uses. It gets the job done, but it lives in a gray area, so a few honest notes:

- **Deletions are permanent** — no undo, no trash. A full wipe really does clear every playlist, album, music video, song and rating. The confirmation prompts are the only safety net.
- **It's not the "official" way.** Apple's terms expect you to use their own apps, so scripting your library like this isn't strictly sanctioned. For personal use on your own account this is low-stakes in practice, but it's your call and your account.
- **Treat your tokens like a password.** The `media-user-token` controls your whole library — don't share it or paste it anywhere you don't trust.

If you'd rather stay fully above board, the sanctioned paths are: [Apple MusicKit](https://developer.apple.com/musickit/) with a paid Apple Developer account (it authorizes through Apple's own consent flow instead of copied tokens), intelligent playlists if you own a Mac, or manually deleting your 3,000 favorited songs one by one 💀. This project exists for the free, no-account, no-carpal-tunnel route; use it at your own risk.

---

## How it works

Apple Music "favorites" are stored as **ratings** (`value: 1`) in Apple's API. Un-favoriting is just deleting the rating (`DELETE /v1/me/ratings/library-songs/{id}`). Library items — songs, albums, playlists, music videos — each have their own deletion endpoint under `/v1/me/library/…`.

The API needs two credentials, both of which your logged-in web-player session already holds:

| Header | What it is | Lifetime |
|---|---|---|
| `authorization` | The web player's developer token (a JWT) | ~6 months |
| `media-user-token` | Your personal session token | Long-lived |

Apple's servers only accept requests originating from `*.apple.com`, so a plain browser page can't call the API directly. The web app gets around this with a tiny **local Node server**: your browser talks to it, and it relays the calls to Apple with the right origin. Your tokens travel only between your browser, your own server, and Apple — nothing is persisted anywhere.

## Getting your two tokens

1. Open [music.apple.com](https://music.apple.com) and **sign in**.
2. Open DevTools (`F12`, or `⌘⌥I` on macOS) and select the **Network** tab.
3. Type `amp-api` in the filter box, then click around your Library until requests appear.
4. Click any request and find **Request Headers**:
   - `authorization` — copy everything **after** `Bearer ` (a long string starting with `eyJ`).
   - `media-user-token` — copy the whole value.

Those are the two values both the web app and the CLI ask for.

## Web app

Requires Node.js 20+.

```sh
git clone https://github.com/mpellouin/apple-music-cleaner
cd apple-music-cleaner
npm install
npm run web            # → http://localhost:3000
```

Then in your browser:

1. **Connect** — paste the two tokens. The app validates them locally and shows the JWT's expiry date.
2. **Review** — it loads your library and shows live counts: songs, albums, playlists, music videos, favorites (with an expandable track list).
3. **Clean** — selective cleanup (presets + preview), remove all favorites, delete empty playlists, or wipe the entire library (type `DELETE` to arm). Preview buttons dry-run before destructive actions.

## Install

```sh
npm install -g apple-music-cleaner   # or clone + npm install
npx apple-music-cleaner presets      # list built-in presets
```

Requires Node.js 20+. Site: [mpellouin.github.io/apple-music-cleaner](https://mpellouin.github.io/apple-music-cleaner/) · AI index: [`llms.txt`](llms.txt)

## CLI usage

```sh
cp .env.example .env   # paste your two tokens in
```

Every command is a **dry run by default** — it lists what it found and deletes nothing until you add `--execute`.

```sh
# Remove the favorite rating from every favorited song
npm start                          # dry run: list favorites
npm start -- --execute             # actually remove them

# Remove only stale favorites (no recent play)
npm start -- --no-plays-within 90 --execute

# Remove dislikes only
npm start -- dislikes --execute

# Wipe scoped to songs and playlists only, skip purchased music
npm start -- wipe --category songs,playlists --exclude-purchased --execute

# Clear dislike ratings without deleting library items
npm start -- wipe --dislikes-only --execute

# Export targets to CSV before deleting
npm start -- --artist "Various Artists" --export stale.csv --execute
```

# Use a preset (dry run)
npm start -- --preset stale-favorites

# Remove favorites added more than a year ago
npm start -- --added-before 365 --execute

# Duplicate favorites, orphan albums, outside heavy rotation
npm start -- --duplicates-only --execute
npm start -- --orphan-album --execute
npm start -- --outside-heavy-rotation --execute

# Delete empty playlists
npm start -- empty-playlists --execute

# Snapshot before/after cleanup
npm start -- snapshot save before.json
npm start -- snapshot compare before.json

# Retry failed deletions
npm start -- resume failures.json --execute

# Cron-friendly (non-interactive)
AMC_EXECUTE=1 npm start -- --preset spring-clean --execute --failure-log failures.json
```

### Commands

| Command | Effect |
|---|---|
| `favorites` (default) | Remove favorite ratings (optionally filtered) |
| `dislikes` | Remove dislike ratings |
| `wipe` | Delete library items and/or clear ratings |
| `empty-playlists` | Delete playlists with zero tracks |
| `probe-history` | Inspect recent-played API depth |
| `probe-added` | Inspect recently-added API |
| `probe-rotation` | Inspect heavy-rotation feed |
| `presets` | List built-in cleanup presets |
| `snapshot save\|compare <file>` | Save or compare inventory snapshots |
| `resume <log.json>` | Retry deletions from a failure log |

### Options

| Flag | Applies to | Effect |
|---|---|---|
| `--execute` | all | Actually delete (default is dry run) |
| `--preset <name>` | favorites, dislikes | Built-in rule preset (`presets` command) |
| `--scan` | favorites | Full library scan instead of Favorite Songs playlist |
| `--no-plays-within <days>` | favorites, dislikes | Absent from recent-played feed |
| `--never-played` | favorites, dislikes | Not in recent-played feed |
| `--added-before <days>` | favorites, dislikes | `dateAdded` older than N days |
| `--duplicates-only` | favorites | Duplicate catalog id / title entries |
| `--orphan-album` | favorites | Album no longer in library |
| `--outside-heavy-rotation` | favorites | Not in heavy-rotation feed |
| `--artist`, `--exclude-artist`, `--title` | favorites, dislikes | Text filters |
| `--keep-file`, `--exclude-purchased`, `--export` | favorites, dislikes | Safety & export |
| `--failure-log`, `--verbose` | favorites, dislikes, wipe | Resume support & full preview |
| `--category`, `--dislikes-only` | wipe | Scoped wipe |

```sh
npm start -- probe-history
npm start -- probe-added
npm start -- probe-rotation
npm start -- presets
```

**Note:** Play counts are not exposed by API. `--no-plays-within` uses the bounded recent-played feed. For richer play data on Mac, see [docs/mac-library-db.md](docs/mac-library-db.md).

### Web app

Selective cleanup wizard with presets, preview-with-reasons, empty playlists, and token expiry notice.

### Advanced docs (Tier D)

| Doc | Topic |
|---|---|
| [docs/mac-library-db.md](docs/mac-library-db.md) | Music.app SQLite on macOS |
| [docs/applescript.md](docs/applescript.md) | Shortcuts, cron, AppleScript |
| [docs/recommendations-reset.md](docs/recommendations-reset.md) | Reset taste profile after wipe |

Enable GitHub Pages manually: repo **Settings → Pages →** source **Deploy from branch →** branch `main`, folder `/docs`.

## FAQ

### How do I bulk remove all Apple Music favorites without a paid developer account?

Clone this repo, paste your two web-player tokens (see [Getting your two tokens](#getting-your-two-tokens)), then run `npm start -- --execute`. Default is dry-run — it lists favorites without deleting.

### Can I delete Apple Music liked songs from the command line?

Yes. `npm start -- --execute` removes the favorite rating from every favorited track. Use `--no-plays-within 90 --execute` to remove only favorites you haven't played recently.

### How is this different from Apple MusicKit?

| | apple-music-cleaner | MusicKit (official) |
|---|---|---|
| Apple Developer account | Not required | Paid account required |
| Auth | Copy tokens from music.apple.com DevTools | OAuth consent flow |
| API | Private web-player API | Documented public API |
| Bulk remove favorites | Yes | Possible with dev setup |
| Wipe entire library | Yes | Not a built-in feature |

### Does this clear my Apple Music play history or recommendations?

No. The tool can read a **bounded** recent-played feed to support selective cleanup, but it cannot wipe your full listening history or reset Apple's recommendation profile. After a library wipe, recommendations fade over time; Apple Support can hard-reset them on request.

### Is this safe? Will Apple ban my account?

This uses the same API as the music.apple.com web player on your own account. It's not officially sanctioned — see [Run this at your own risk](#run-this-at-your-own-risk). Treat tokens like passwords.

## What it can and cannot delete

**Can:** favorites, dislikes and other ratings (library- and catalog-level), library songs, albums, playlists, music videos.

**Cannot:**
- The system **Favorite Songs** playlist itself — Apple rejects that deletion server-side, so it just ends up empty (one "failure" there during a wipe is expected).
- Your full **listening history** or **recommendation profile** — only a bounded recent-played feed is readable; nothing clears history or resets recommendations via API. Recommendations fade once your library is empty; Apple Support can hard-reset them on request.
- **Purchases** — purchased music stays tied to your Apple ID even after removal from the library view.

## License

[MIT](LICENSE) — provided "as is", without warranty of any kind. You assume all risk.

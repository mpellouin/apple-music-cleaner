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
3. **Clean** — either **Remove all favorites**, or **Wipe entire library** (which only arms after you type `DELETE`, then asks for a final confirmation). A progress bar and log track every deletion, and a summary reports anything that failed.

## CLI usage

```sh
cp .env.example .env   # paste your two tokens in
```

Every command is a **dry run by default** — it lists what it found and deletes nothing until you add `--execute`.

```sh
# Remove the favorite rating from every favorited song
npm start                          # dry run: list favorites
npm start -- --execute             # actually remove them

# Wipe the entire library: playlists, albums, music videos, songs, ratings
npm start -- wipe                  # dry run: inventory only
npm start -- wipe --execute        # actually delete everything
```

Options: `--playlist "<name>"` targets a favorites playlist the auto-detection missed (names vary by locale); `--scan` forces a full library scan instead of using the Favorite Songs playlist.

## What it can and cannot delete

**Can:** favorites, dislikes and other ratings (library- and catalog-level), library songs, albums, playlists, music videos.

**Cannot:**
- The system **Favorite Songs** playlist itself — Apple rejects that deletion server-side, so it just ends up empty (one "failure" there during a wipe is expected).
- Your **listening/play history** and **recommendation profile** — no API endpoints exist. Recommendations fade once your library is empty; Apple Support can hard-reset them on request.
- **Purchases** — purchased music stays tied to your Apple ID even after removal from the library view.

## License

[MIT](LICENSE) — provided "as is", without warranty of any kind. You assume all risk.

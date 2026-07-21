# Reset Apple Music recommendations (Tier D)

apple-music-cleaner can empty your library and clear ratings, but **cannot** reset Apple's recommendation / taste profile via API.

## What happens after a wipe

- **For You**, **Discovery Station**, and personalized mixes gradually change as you listen again.
- An empty library often makes recommendations generic until new signals accumulate.

## Hard reset (official)

Contact [Apple Support](https://support.apple.com/music) and ask to **reset your Apple Music recommendations** or **clear listening history** for your account.

Be explicit that you want:

- Listening history cleared
- Personalized recommendations reset

Support can do this server-side; no user-facing self-service toggle exists.

## Partial alternatives

| Action | Effect |
|---|---|
| Wipe library with this tool | Removes saved content; recommendations fade over weeks |
| `probe-history` / `probe-rotation` | Inspect what Apple still knows about recent activity |
| Stop using Apple Music for a period | Weak signal refresh (slow) |

## After reset

1. Re-favorite a small set of seed artists.
2. Listen intentionally for a few sessions.
3. Avoid bulk re-favoriting thousands of tracks immediately — it skews the profile again.

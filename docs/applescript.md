# AppleScript & Shortcuts (Tier D)

Run apple-music-cleaner from macOS automations after tokens are in `.env`.

## Shortcuts (recommended)

1. Add a **Run Shell Script** action.
2. Set shell to `/bin/zsh`.
3. Example:

```bash
cd "$HOME/path/to/apple-music-cleaner"
export AMC_EXECUTE=1
npm start -- --preset stale-favorites --execute --failure-log /tmp/amc-failures.json
```

Schedule via **Calendar**, **cron**, or Shortcuts automations.

## cron example

```cron
# Every Sunday 3am — remove stale favorites (dry-run logs only unless AMC_EXECUTE=1)
0 3 * * 0 cd /Users/you/apple-music-cleaner && AMC_EXECUTE=1 npm start -- --preset stale-favorites --execute >> /tmp/amc.log 2>&1
```

## AppleScript (open Terminal + run)

```applescript
tell application "Terminal"
  do script "cd ~/Delivery/apple-music-cleaner && npm start -- --preset spring-clean"
end tell
```

For headless use, prefer cron/Shortcuts over AppleScript.

## Token refresh

JWT tokens expire (~6 months). When the CLI prints a token warning, refresh tokens from music.apple.com DevTools and update `.env`.

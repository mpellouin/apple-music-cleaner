import { loadConfig } from './config.js'
import { AppleMusicClient } from './client.js'
import { runRatedCleanup, rulesFromPresetAndArgs } from './cleanup-runner.js'
import {
  dislikesFromScan,
  favoritesFromPlaylist,
  favoritesFromScan,
  findFavoritesPlaylistId,
  RATING_DISLIKE,
} from './favorites.js'
import { probeHeavyRotation } from './heavy-rotation.js'
import { probeRecentHistory } from './history.js'
import { loadKeepFile } from './keep-file.js'
import { listEmptyPlaylists } from './library-clean.js'
import { probeRecentlyAdded } from './library-meta.js'
import { listPresets } from './presets.js'
import { resumeFailureLog, writeFailureLog, failuresToLogEntries } from './failure-log.js'
import type { CleanRules } from './rules.js'
import {
  captureSnapshot,
  compareSnapshots,
  loadSnapshot,
  saveSnapshot,
} from './snapshot.js'
import { inspectDevToken } from './token-info.js'
import {
  categoriesForKeys,
  CATEGORIES,
  deleteItems,
  deleteRatings,
  filterPurchased,
  findRatings,
  listCategory,
  type Failure,
} from './wipe.js'

const HELP = `apple-music-cleaner — clean up your Apple Music account

Usage: npm start -- [command] [options]

Commands:
  favorites (default)  Remove favorite ratings (optionally filtered)
  dislikes             Remove dislike ratings
  wipe                 Delete library items and/or clear ratings
  empty-playlists      Delete playlists with zero tracks
  probe-history        Inspect recent-played API depth
  probe-added          Inspect recently-added API
  probe-rotation       Inspect heavy-rotation feed
  presets              List built-in cleanup presets
  snapshot             Save or compare library inventory snapshots
  resume <log.json>    Retry deletions from a failure log

Options:
  --execute              Actually delete (default: dry run)
  --preset <name>        Apply a built-in rule preset (see "presets" command)
  --scan                 Skip Favorite Songs playlist shortcut
  --playlist <name>      Favorites playlist name override
  --no-plays-within <d>  Tracks absent from recent-played feed
  --never-played         Tracks not in recent-played feed
  --added-before <d>     Tracks added more than N days ago (dateAdded)
  --artist <name>        Artist substring match
  --exclude-artist <n>   Skip matching artists
  --title <pattern>      Title match (/regex/flags or substring)
  --keep-file <path>     Protected tracks list
  --exclude-purchased    Skip purchased tracks/items
  --duplicates-only      Only duplicate favorite entries
  --orphan-album         Favorites whose album left the library
  --outside-heavy-rotation  Favorites not in heavy-rotation feed
  --export <path>        CSV export of targets (with reasons)
  --failure-log <path>   Write failures to JSON for resume
  --verbose              Show all preview lines (not just first 20)
  --category <keys>      wipe: playlists, albums, music videos, songs
  --dislikes-only        wipe: clear dislikes without deleting items
  --help                 Show this help

Cron: set AMC_EXECUTE=1 and pass --execute for non-interactive scheduled runs.
`

type Command =
  | 'favorites'
  | 'dislikes'
  | 'wipe'
  | 'empty-playlists'
  | 'probe-history'
  | 'probe-added'
  | 'probe-rotation'
  | 'presets'
  | 'snapshot'
  | 'resume'

interface Args {
  command: Command
  execute: boolean
  scan: boolean
  verbose: boolean
  playlist?: string
  preset?: string
  noPlaysWithinDays?: number
  neverPlayed: boolean
  addedBeforeDays?: number
  artist?: string
  excludeArtist?: string
  titlePattern?: RegExp
  keepFile?: string
  excludePurchased: boolean
  duplicatesOnly: boolean
  orphanAlbum: boolean
  outsideHeavyRotation: boolean
  exportPath?: string
  failureLogPath?: string
  categories?: string[]
  dislikesOnly: boolean
  snapshotPath?: string
  snapshotMode?: 'save' | 'compare'
  resumePath?: string
}

function parseTitlePattern(raw: string): RegExp {
  if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const last = raw.lastIndexOf('/')
    return new RegExp(raw.slice(1, last), raw.slice(last + 1) || 'i')
  }
  return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'favorites',
    execute: process.env.AMC_EXECUTE === '1',
    scan: false,
    verbose: false,
    neverPlayed: false,
    excludePurchased: false,
    duplicatesOnly: false,
    orphanAlbum: false,
    outsideHeavyRotation: false,
    dislikesOnly: false,
  }

  let i = 0
  if (argv[0] === 'snapshot') {
    args.command = 'snapshot'
    args.snapshotMode = argv[1] === 'compare' ? 'compare' : 'save'
    args.snapshotPath = argv[2]
    i = 3
  } else if (argv[0] === 'resume') {
    args.command = 'resume'
    args.resumePath = argv[1]
    i = 2
  } else {
    for (; i < argv.length; i++) {
      const token = argv[i]
      if (token.startsWith('-')) break
      switch (token) {
        case 'favorites':
        case 'dislikes':
        case 'wipe':
        case 'empty-playlists':
        case 'probe-history':
        case 'probe-added':
        case 'probe-rotation':
        case 'presets':
          args.command = token
          break
        default:
          console.error(`Unknown command: ${token}\n\n${HELP}`)
          process.exit(2)
      }
    }
  }

  for (; i < argv.length; i++) {
    const flag = argv[i]
    const valueFlags = new Set([
      '--playlist',
      '--preset',
      '--artist',
      '--exclude-artist',
      '--keep-file',
      '--export',
      '--category',
      '--title',
      '--failure-log',
      '--no-plays-within',
      '--added-before',
    ])
    const value = valueFlags.has(flag) ? argv[++i] : undefined

    switch (flag) {
      case '--execute':
        args.execute = true
        break
      case '--scan':
        args.scan = true
        break
      case '--verbose':
        args.verbose = true
        break
      case '--never-played':
        args.neverPlayed = true
        break
      case '--exclude-purchased':
        args.excludePurchased = true
        break
      case '--duplicates-only':
        args.duplicatesOnly = true
        break
      case '--orphan-album':
        args.orphanAlbum = true
        break
      case '--outside-heavy-rotation':
        args.outsideHeavyRotation = true
        break
      case '--dislikes-only':
        args.dislikesOnly = true
        break
      case '--playlist':
        args.playlist = value
        break
      case '--preset':
        args.preset = value
        break
      case '--artist':
        args.artist = value
        break
      case '--exclude-artist':
        args.excludeArtist = value
        break
      case '--keep-file':
        args.keepFile = value
        break
      case '--export':
        args.exportPath = value
        break
      case '--failure-log':
        args.failureLogPath = value
        break
      case '--category':
        args.categories = value?.split(',').map((s) => s.trim())
        break
      case '--title':
        if (!value) throw new Error('--title requires a value')
        args.titlePattern = parseTitlePattern(value)
        break
      case '--no-plays-within': {
        const days = Number(value?.replace(/d$/i, ''))
        if (!value || !Number.isFinite(days) || days <= 0) {
          console.error('--no-plays-within requires a positive number of days\n\n' + HELP)
          process.exit(2)
        }
        args.noPlaysWithinDays = days
        break
      }
      case '--added-before': {
        const days = Number(value?.replace(/d$/i, ''))
        if (!value || !Number.isFinite(days) || days <= 0) {
          console.error('--added-before requires a positive number of days\n\n' + HELP)
          process.exit(2)
        }
        args.addedBeforeDays = days
        break
      }
      case '--help':
        console.log(HELP)
        process.exit(0)
        break
      default:
        console.error(`Unknown option: ${flag}\n\n${HELP}`)
        process.exit(2)
    }
  }

  if (args.command === 'resume' && !args.resumePath) {
    console.error('resume requires a failure log path\n\n' + HELP)
    process.exit(2)
  }
  if (args.command === 'snapshot' && !args.snapshotPath) {
    console.error('snapshot requires a file path: snapshot save|compare <file.json>\n\n' + HELP)
    process.exit(2)
  }

  return args
}

function rulesFromArgs(args: Args): CleanRules {
  let rules: CleanRules = {}
  if (args.preset) rules = rulesFromPresetAndArgs(rules, args.preset)
  if (args.noPlaysWithinDays !== undefined) rules.noPlaysWithinDays = args.noPlaysWithinDays
  if (args.neverPlayed) rules.neverPlayed = true
  if (args.addedBeforeDays !== undefined) rules.addedBeforeDays = args.addedBeforeDays
  if (args.artist) rules.artist = args.artist
  if (args.excludeArtist) rules.excludeArtist = args.excludeArtist
  if (args.titlePattern) rules.titlePattern = args.titlePattern
  if (args.excludePurchased) rules.excludePurchased = true
  if (args.duplicatesOnly) rules.duplicatesOnly = true
  if (args.orphanAlbum) rules.orphanAlbumOnly = true
  if (args.outsideHeavyRotation) rules.outsideHeavyRotation = true
  if (args.keepFile) rules.keepEntries = loadKeepFile(args.keepFile)
  return rules
}

function warnTokenExpiry(): void {
  try {
    const info = inspectDevToken(loadConfig().devToken)
    if (info.expired) console.error(`⚠ Token: ${info.message}`)
    else if (info.expiresAt) {
      const daysLeft = (info.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      if (daysLeft < 14) console.error(`⚠ Token expires in ${Math.ceil(daysLeft)} day(s): ${info.message}`)
    }
  } catch {
    /* config errors surface in main */
  }
}

async function loadFavorites(client: AppleMusicClient, args: Args) {
  if (!args.scan) {
    const playlistId = await findFavoritesPlaylistId(client, args.playlist)
    return playlistId ? await favoritesFromPlaylist(client, playlistId) : await favoritesFromScan(client)
  }
  return favoritesFromScan(client)
}

async function runWipe(client: AppleMusicClient, args: Args): Promise<void> {
  const cats = categoriesForKeys(args.categories)
  console.log('Inventorying library…')
  const inventory: { cat: (typeof CATEGORIES)[number]; items: Awaited<ReturnType<typeof listCategory>> }[] = []
  let skippedPurchased = 0

  for (const cat of cats) {
    let items = await listCategory(client, cat)
    if (args.excludePurchased) {
      const filtered = filterPurchased(items)
      skippedPurchased += filtered.skipped
      items = filtered.items
    }
    inventory.push({ cat, items })
    console.log(`  ${cat.key}: ${items.length}`)
  }

  if (args.excludePurchased && skippedPurchased > 0) {
    console.log(`  (${skippedPurchased} purchased item(s) excluded)`)
  }

  const ratingValue = args.dislikesOnly ? RATING_DISLIKE : undefined
  const ratings = []
  for (const { cat, items } of inventory) {
    ratings.push(...(await findRatings(client, cat, items, ratingValue)))
  }
  const ratingLabel = args.dislikesOnly ? 'dislikes' : 'ratings/dislikes'
  console.log(`  ${ratingLabel} to clear: ${ratings.length}`)

  const totalItems = args.dislikesOnly ? 0 : inventory.reduce((n, { items }) => n + items.length, 0)
  if (totalItems === 0 && ratings.length === 0) {
    console.log('Nothing matched the wipe scope.')
    return
  }

  if (!args.execute) {
    console.log(`\nDry run: re-run with --execute to delete.`)
    return
  }

  const failures: Failure[] = []
  if (ratings.length > 0) {
    failures.push(
      ...(await deleteRatings(client, ratings, (done, total) => {
        process.stderr.write(`\rClearing ${ratingLabel}… ${done}/${total}`)
      })),
    )
    process.stderr.write('\n')
  }

  if (!args.dislikesOnly) {
    for (const { cat, items } of inventory) {
      if (items.length === 0) continue
      failures.push(
        ...(await deleteItems(client, cat, items, (done, total) => {
          process.stderr.write(`\rDeleting ${cat.key}… ${done}/${total}`)
        })),
      )
      process.stderr.write('\n')
    }
  }

  const attempted = totalItems + ratings.length
  console.log(`Done: ${attempted - failures.length}/${attempted} succeeded.`)
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f.label}: ${f.error}`)
    if (args.failureLogPath) {
      writeFailureLog(args.failureLogPath, failuresToLogEntries(failures))
      console.error(`Failures written to ${args.failureLogPath}`)
    }
    process.exitCode = 1
  }
}

async function runEmptyPlaylists(client: AppleMusicClient, args: Args): Promise<void> {
  console.log('Scanning for empty playlists…')
  const empty = await listEmptyPlaylists(client)
  if (empty.length === 0) {
    console.log('No empty playlists found.')
    return
  }
  for (const pl of empty) console.log(`  ${pl.label}`)
  console.log(`\n${empty.length} empty playlist(s).`)
  if (!args.execute) {
    console.log('Dry run: re-run with --execute to delete them.')
    return
  }
  const cat = CATEGORIES.find((c) => c.key === 'playlists')!
  const failures = await deleteItems(client, cat, empty, (done, total) => {
    process.stderr.write(`\rDeleting empty playlists… ${done}/${total}`)
  })
  process.stderr.write('\n')
  console.log(`Done: ${empty.length - failures.length}/${empty.length} deleted.`)
  if (failures.length) process.exitCode = 1
}

async function main(): Promise<void> {
  warnTokenExpiry()
  const args = parseArgs(process.argv.slice(2))
  const client = new AppleMusicClient(loadConfig())

  switch (args.command) {
    case 'probe-history': {
      const probe = await probeRecentHistory(client)
      console.log(`Recent-played entries: ${probe.trackCount} (${probe.uniqueCatalogIds} unique ids)`)
      for (const t of probe.sample) console.log(`  ${t.name} — ${t.artist}`)
      break
    }
    case 'probe-added': {
      const probe = await probeRecentlyAdded(client)
      console.log(`Recently-added entries: ${probe.count}`)
      for (const t of probe.sample) {
        console.log(`  ${t.name} — ${t.artist}${t.dateAdded ? ` (added ${t.dateAdded.slice(0, 10)})` : ''}`)
      }
      break
    }
    case 'probe-rotation': {
      const probe = await probeHeavyRotation(client)
      console.log(`Heavy-rotation entries: ${probe.count}`)
      for (const t of probe.sample) console.log(`  ${t.name} — ${t.artist}`)
      if (probe.count === 0) console.log('(Feed empty — common on some accounts)')
      break
    }
    case 'presets':
      for (const p of listPresets()) console.log(`  ${p.name.padEnd(22)} ${p.description}`)
      break
    case 'snapshot': {
      if (args.snapshotMode === 'compare') {
        const before = loadSnapshot(args.snapshotPath!)
        const after = await captureSnapshot(client)
        for (const line of compareSnapshots(before, after)) console.log(line)
      } else {
        const snap = await captureSnapshot(client)
        saveSnapshot(args.snapshotPath!, snap)
        console.log(`Snapshot saved to ${args.snapshotPath} (${snap.capturedAt})`)
      }
      break
    }
    case 'resume': {
      const remaining = await resumeFailureLog(client, args.resumePath!, (done, total) => {
        process.stderr.write(`\rRetrying… ${done}/${total}`)
      })
      process.stderr.write('\n')
      if (remaining.length === 0) console.log('All retries succeeded.')
      else {
        console.error(`${remaining.length} still failing.`)
        process.exitCode = 1
      }
      break
    }
    case 'wipe':
      await runWipe(client, args)
      break
    case 'empty-playlists':
      await runEmptyPlaylists(client, args)
      break
    case 'dislikes':
      await runRatedCleanup(client, await dislikesFromScan(client), 'disliked', {
        rules: rulesFromArgs(args),
        execute: args.execute,
        exportPath: args.exportPath,
        failureLogPath: args.failureLogPath,
        verbose: args.verbose,
      })
      break
    default:
      await runRatedCleanup(client, await loadFavorites(client, args), 'favorited', {
        rules: rulesFromArgs(args),
        execute: args.execute,
        exportPath: args.exportPath,
        failureLogPath: args.failureLogPath,
        verbose: args.verbose,
      })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

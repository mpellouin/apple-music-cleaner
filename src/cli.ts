import { loadConfig } from './config.js'
import { AppleMusicClient } from './client.js'
import { exportTracksCsv } from './export.js'
import {
  dislikesFromScan,
  favoritesFromPlaylist,
  favoritesFromScan,
  findFavoritesPlaylistId,
  RATING_DISLIKE,
  type FavoriteTrack,
} from './favorites.js'
import { fetchRecentPlayedCatalogIds, probeRecentHistory } from './history.js'
import { loadKeepFile } from './keep-file.js'
import { removeFavorites } from './remove.js'
import { applyFavoriteRules, describeRules, type CleanRules } from './rules.js'
import {
  categoriesForKeys,
  CATEGORIES,
  deleteItems,
  deleteRatings,
  filterPurchased,
  findRatings,
  listCategory,
  type Failure,
  type WipeItem,
} from './wipe.js'

const HELP = `apple-music-cleaner — clean up your Apple Music account

Usage: npm start -- [command] [options]

Commands:
  favorites (default)  Remove the favorite rating from favorited tracks
  dislikes             Remove the dislike rating from disliked tracks
  wipe                 Delete library items and/or clear ratings
  probe-history        Show how much recent-played history the API exposes

Options:
  --execute              Actually delete (default is a dry run that only lists what was found)
  --scan                 Skip the Favorite Songs playlist, scan the whole library
  --playlist <name>      Exact name of your favorites playlist
  --no-plays-within <d>  Only remove tracks absent from recent-played history
  --artist <name>        Only remove tracks whose artist contains this (case-insensitive)
  --exclude-artist <n>   Skip tracks whose artist contains this
  --title <pattern>      Only remove tracks whose title matches (/regex/flags or substring)
  --keep-file <path>     Never remove tracks listed in this file (catalog id or "Artist — Title")
  --exclude-purchased    Skip purchased tracks
  --export <path>        Write selected targets to CSV before deleting
  --category <keys>      wipe: comma-separated scope (playlists, albums, music videos, songs)
  --dislikes-only        wipe: clear dislike ratings only, do not delete library items
  --help                 Show this help
`

interface Args {
  command: 'favorites' | 'dislikes' | 'wipe' | 'probe-history'
  execute: boolean
  scan: boolean
  playlist?: string
  noPlaysWithinDays?: number
  artist?: string
  excludeArtist?: string
  titlePattern?: RegExp
  keepFile?: string
  excludePurchased: boolean
  exportPath?: string
  categories?: string[]
  dislikesOnly: boolean
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
    execute: false,
    scan: false,
    excludePurchased: false,
    dislikesOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case 'favorites':
        break
      case 'dislikes':
        args.command = 'dislikes'
        break
      case 'wipe':
        args.command = 'wipe'
        break
      case 'probe-history':
        args.command = 'probe-history'
        break
      case '--execute':
        args.execute = true
        break
      case '--scan':
        args.scan = true
        break
      case '--dislikes-only':
        args.dislikesOnly = true
        break
      case '--exclude-purchased':
        args.excludePurchased = true
        break
      case '--playlist':
      case '--artist':
      case '--exclude-artist':
      case '--keep-file':
      case '--export':
      case '--category':
      case '--title': {
        const value = argv[++i]
        if (!value) {
          console.error(`${argv[i - 1]} requires a value\n\n${HELP}`)
          process.exit(2)
        }
        if (argv[i - 1] === '--playlist') args.playlist = value
        else if (argv[i - 1] === '--artist') args.artist = value
        else if (argv[i - 1] === '--exclude-artist') args.excludeArtist = value
        else if (argv[i - 1] === '--keep-file') args.keepFile = value
        else if (argv[i - 1] === '--export') args.exportPath = value
        else if (argv[i - 1] === '--category') args.categories = value.split(',').map((s) => s.trim())
        else args.titlePattern = parseTitlePattern(value)
        break
      }
      case '--no-plays-within': {
        const raw = argv[++i]
        const days = Number(raw?.replace(/d$/i, ''))
        if (!raw || !Number.isFinite(days) || days <= 0) {
          console.error('--no-plays-within requires a positive number of days\n\n' + HELP)
          process.exit(2)
        }
        args.noPlaysWithinDays = days
        break
      }
      case '--help':
        console.log(HELP)
        process.exit(0)
        break
      default:
        console.error(`Unknown option: ${argv[i]}\n\n${HELP}`)
        process.exit(2)
    }
  }
  return args
}

function rulesFromArgs(args: Args): CleanRules {
  const rules: CleanRules = {}
  if (args.noPlaysWithinDays !== undefined) rules.noPlaysWithinDays = args.noPlaysWithinDays
  if (args.artist) rules.artist = args.artist
  if (args.excludeArtist) rules.excludeArtist = args.excludeArtist
  if (args.titlePattern) rules.titlePattern = args.titlePattern
  if (args.excludePurchased) rules.excludePurchased = true
  if (args.keepFile) rules.keepEntries = loadKeepFile(args.keepFile)
  return rules
}

function reportFailures(failures: Failure[]): void {
  if (failures.length === 0) return
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ${f.label}: ${f.error}`)
  process.exitCode = 1
}

async function loadFavorites(client: AppleMusicClient, args: Args): Promise<FavoriteTrack[]> {
  if (!args.scan) {
    const playlistId = await findFavoritesPlaylistId(client, args.playlist)
    return playlistId ? await favoritesFromPlaylist(client, playlistId) : await favoritesFromScan(client)
  }
  return favoritesFromScan(client)
}

async function runProbeHistory(client: AppleMusicClient): Promise<void> {
  console.log('Fetching recent-played history from Apple Music API…')
  const probe = await probeRecentHistory(client)
  console.log(`  entries returned: ${probe.trackCount}`)
  console.log(`  unique catalog ids: ${probe.uniqueCatalogIds}`)
  if (probe.sample.length > 0) {
    console.log('  most recent tracks:')
    for (const t of probe.sample) console.log(`    ${t.name} — ${t.artist}`)
  }
  console.log(
    '\nNote: Apple exposes a bounded recent-played feed, not a full play log. ' +
      'Use --no-plays-within with this in mind.',
  )
}

function printSelectionSummary(
  total: number,
  selection: ReturnType<typeof applyFavoriteRules>,
  rules: CleanRules,
): void {
  const labels = describeRules(rules)
  if (labels.length > 0) {
    console.log('Rules: ' + labels.join('; '))
    console.log(`  ${total} track(s) in scope`)
    console.log(`  ${selection.targets.length} selected for removal`)
    if (selection.skippedPurchased > 0) {
      console.log(`  ${selection.skippedPurchased} skipped (purchased)`)
    }
    if (selection.skippedKeepList > 0) {
      console.log(`  ${selection.skippedKeepList} skipped (keep-list)`)
    }
    if (selection.skippedNoCatalogId > 0) {
      console.log(`  ${selection.skippedNoCatalogId} skipped (no catalog id — cannot match play history)`)
    }
  }
}

async function runRatedCleanup(
  client: AppleMusicClient,
  args: Args,
  loadTracks: (client: AppleMusicClient, args: Args) => Promise<FavoriteTrack[]>,
  actionLabel: string,
): Promise<void> {
  const tracks = await loadTracks(client, args)
  if (tracks.length === 0) {
    console.log(`No ${actionLabel} tracks found. Nothing to do.`)
    return
  }

  const rules = rulesFromArgs(args)
  let played: Set<string> | undefined
  if (rules.noPlaysWithinDays !== undefined) {
    process.stderr.write('Loading recent-played history…')
    played = await fetchRecentPlayedCatalogIds(client, (n) => {
      process.stderr.write(`\rLoading recent-played history… ${n} entries`)
    })
    process.stderr.write('\n')
  }

  const selection = applyFavoriteRules(tracks, rules, played)
  printSelectionSummary(tracks.length, selection, rules)

  if (selection.targets.length === 0) {
    console.log('No tracks match the cleanup rules. Nothing to do.')
    return
  }

  for (const t of selection.targets) console.log(`  ${t.name} — ${t.artist}`)
  console.log(`\n${selection.targets.length} track(s) selected.`)

  if (args.exportPath) {
    exportTracksCsv(args.exportPath, selection.targets)
    console.log(`Exported to ${args.exportPath}`)
  }

  if (!args.execute) {
    console.log('Dry run: nothing was deleted. Re-run with --execute to remove them.')
    return
  }

  const failures = await removeFavorites(client, selection.targets, (done, total) => {
    process.stderr.write(`\rRemoving ${actionLabel}… ${done}/${total}`)
  })
  process.stderr.write('\n')
  console.log(`Done: ${selection.targets.length - failures.length}/${selection.targets.length} removed.`)
  reportFailures(failures.map((f) => ({ label: `${f.track.name} — ${f.track.artist}`, error: f.error })))
}

async function runWipe(client: AppleMusicClient, args: Args): Promise<void> {
  const cats = categoriesForKeys(args.categories)
  console.log('Inventorying library…')
  const inventory: { cat: (typeof CATEGORIES)[number]; items: WipeItem[] }[] = []
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

  console.log('Checking ratings…')
  const ratingValue = args.dislikesOnly ? RATING_DISLIKE : undefined
  const ratings = []
  for (const { cat, items } of inventory) {
    ratings.push(...(await findRatings(client, cat, items, ratingValue)))
  }
  const ratingLabel = args.dislikesOnly ? 'dislikes' : 'ratings/dislikes'
  console.log(`  ${ratingLabel} to clear: ${ratings.length}`)

  const totalItems = args.dislikesOnly ? 0 : inventory.reduce((n, { items }) => n + items.length, 0)
  if (totalItems === 0 && ratings.length === 0) {
    console.log('Nothing matched the wipe scope. Nothing to do.')
    return
  }

  if (!args.execute) {
    const scope = args.dislikesOnly ? 'dislike ratings' : `${totalItems} item(s) and ${ratings.length} rating(s)`
    console.log(`\nDry run: nothing was deleted. Re-run with "wipe --execute" to delete ${scope}. This is irreversible.`)
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
  console.log(`Done: ${attempted - failures.length}/${attempted} deletions succeeded.`)
  reportFailures(failures)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const client = new AppleMusicClient(loadConfig())
  if (args.command === 'wipe') await runWipe(client, args)
  else if (args.command === 'probe-history') await runProbeHistory(client)
  else if (args.command === 'dislikes') {
    await runRatedCleanup(client, args, () => dislikesFromScan(client), 'disliked')
  } else {
    await runRatedCleanup(client, args, loadFavorites, 'favorited')
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

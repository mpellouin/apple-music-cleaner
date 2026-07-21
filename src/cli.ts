import { loadConfig } from './config.js'
import { AppleMusicClient } from './client.js'
import {
  favoritesFromPlaylist,
  favoritesFromScan,
  findFavoritesPlaylistId,
  type FavoriteTrack,
} from './favorites.js'
import { fetchRecentPlayedCatalogIds, probeRecentHistory } from './history.js'
import { removeFavorites } from './remove.js'
import { describeRule, selectFavoritesForRemoval, type CleanRules } from './rules.js'
import {
  CATEGORIES,
  deleteItems,
  deleteRatings,
  findRatings,
  listCategory,
  type Failure,
  type WipeItem,
} from './wipe.js'

const HELP = `apple-music-cleaner — clean up your Apple Music account

Usage: npm start -- [command] [options]

Commands:
  favorites (default)  Remove the favorite rating from favorited tracks
  wipe                 Delete the entire library: playlists, albums, music
                       videos, songs, and every remaining rating/dislike
  probe-history        Show how much recent-played history the API exposes

Options:
  --execute              Actually delete (default is a dry run that only lists what was found)
  --scan                 favorites: skip the Favorite Songs playlist, scan the whole library
  --playlist <name>      favorites: exact name of your favorites playlist
  --no-plays-within <d>  favorites: only remove favorites absent from recent-played history
                         (approximates "0 plays in the last N days"; history depth is API-limited)
  --help                 Show this help
`

interface Args {
  command: 'favorites' | 'wipe' | 'probe-history'
  execute: boolean
  scan: boolean
  playlist?: string
  noPlaysWithinDays?: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: 'favorites', execute: false, scan: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case 'favorites':
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
      case '--playlist':
        args.playlist = argv[++i]
        if (!args.playlist) {
          console.error('--playlist requires a value\n\n' + HELP)
          process.exit(2)
        }
        break
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

async function runFavorites(client: AppleMusicClient, args: Args): Promise<void> {
  const favorites = await loadFavorites(client, args)

  if (favorites.length === 0) {
    console.log('No favorited tracks found. Nothing to do.')
    return
  }

  const rules: CleanRules = {}
  if (args.noPlaysWithinDays !== undefined) rules.noPlaysWithinDays = args.noPlaysWithinDays

  let targets = favorites
  let skippedNoCatalogId = 0

  if (rules.noPlaysWithinDays !== undefined) {
    process.stderr.write('Loading recent-played history…')
    const played = await fetchRecentPlayedCatalogIds(client, (n) => {
      process.stderr.write(`\rLoading recent-played history… ${n} entries`)
    })
    process.stderr.write('\n')
    const selection = selectFavoritesForRemoval(favorites, played, rules)
    targets = selection.targets
    skippedNoCatalogId = selection.skippedNoCatalogId
  }

  const ruleLabel = describeRule(rules)
  if (ruleLabel) {
    console.log(`Rule: ${ruleLabel}`)
    console.log(`  ${favorites.length} favorite(s) total`)
    console.log(`  ${targets.length} would be removed`)
    if (skippedNoCatalogId > 0) {
      console.log(`  ${skippedNoCatalogId} skipped (no catalog id — cannot match play history)`)
    }
  }

  if (targets.length === 0) {
    console.log('No tracks match the cleanup rule. Nothing to do.')
    return
  }

  for (const t of targets) console.log(`  ${t.name} — ${t.artist}`)
  console.log(`\n${targets.length} track(s) selected.`)

  if (!args.execute) {
    console.log('Dry run: nothing was deleted. Re-run with --execute to remove them.')
    return
  }

  const failures = await removeFavorites(client, targets, (done, total) => {
    process.stderr.write(`\rRemoving favorites… ${done}/${total}`)
  })
  process.stderr.write('\n')
  console.log(`Done: ${targets.length - failures.length}/${targets.length} favorites removed.`)
  reportFailures(failures.map((f) => ({ label: `${f.track.name} — ${f.track.artist}`, error: f.error })))
}

async function runWipe(client: AppleMusicClient, args: Args): Promise<void> {
  console.log('Inventorying library…')
  const inventory: { cat: (typeof CATEGORIES)[number]; items: WipeItem[] }[] = []
  for (const cat of CATEGORIES) {
    const items = await listCategory(client, cat)
    inventory.push({ cat, items })
    console.log(`  ${cat.key}: ${items.length}`)
  }

  console.log('Checking remaining ratings…')
  const ratings = []
  for (const { cat, items } of inventory) {
    ratings.push(...(await findRatings(client, cat, items)))
  }
  console.log(`  ratings/dislikes to clear: ${ratings.length}`)

  const totalItems = inventory.reduce((n, { items }) => n + items.length, 0)
  if (totalItems === 0 && ratings.length === 0) {
    console.log('Library is already empty. Nothing to do.')
    return
  }

  if (!args.execute) {
    console.log(
      `\nDry run: nothing was deleted. Re-run with "wipe --execute" to delete all ${totalItems} item(s) and ${ratings.length} rating(s). This is irreversible.`,
    )
    return
  }

  const failures: Failure[] = []

  if (ratings.length > 0) {
    failures.push(
      ...(await deleteRatings(client, ratings, (done, total) => {
        process.stderr.write(`\rClearing ratings… ${done}/${total}`)
      })),
    )
    process.stderr.write('\n')
  }

  for (const { cat, items } of inventory) {
    if (items.length === 0) continue
    failures.push(
      ...(await deleteItems(client, cat, items, (done, total) => {
        process.stderr.write(`\rDeleting ${cat.key}… ${done}/${total}`)
      })),
    )
    process.stderr.write('\n')
  }

  console.log(
    `Done: ${totalItems + ratings.length - failures.length}/${totalItems + ratings.length} deletions succeeded.`,
  )
  reportFailures(failures)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const client = new AppleMusicClient(loadConfig())
  if (args.command === 'wipe') await runWipe(client, args)
  else if (args.command === 'probe-history') await runProbeHistory(client)
  else await runFavorites(client, args)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

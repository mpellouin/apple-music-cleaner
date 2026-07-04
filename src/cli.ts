import { loadConfig } from './config.js'
import { AppleMusicClient } from './client.js'
import {
  favoritesFromPlaylist,
  favoritesFromScan,
  findFavoritesPlaylistId,
  type FavoriteTrack,
} from './favorites.js'
import { removeFavorites } from './remove.js'
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
  favorites (default)  Remove the favorite rating from all favorited tracks
  wipe                 Delete the entire library: playlists, albums, music
                       videos, songs, and every remaining rating/dislike

Options:
  --execute          Actually delete (default is a dry run that only lists what was found)
  --scan             favorites: skip the Favorite Songs playlist, scan the whole library
  --playlist <name>  favorites: exact name of your favorites playlist
  --help             Show this help
`

interface Args {
  command: 'favorites' | 'wipe'
  execute: boolean
  scan: boolean
  playlist?: string
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
      case '--execute':
        args.execute = true
        break
      case '--scan':
        args.scan = true
        break
      case '--playlist':
        args.playlist = argv[++i]
        break
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

async function runFavorites(client: AppleMusicClient, args: Args): Promise<void> {
  let favorites: FavoriteTrack[]
  if (!args.scan) {
    const playlistId = await findFavoritesPlaylistId(client, args.playlist)
    favorites = playlistId ? await favoritesFromPlaylist(client, playlistId) : await favoritesFromScan(client)
  } else {
    favorites = await favoritesFromScan(client)
  }

  if (favorites.length === 0) {
    console.log('No favorited tracks found. Nothing to do.')
    return
  }
  for (const t of favorites) console.log(`  ${t.name} — ${t.artist}`)
  console.log(`\n${favorites.length} favorited track(s) found.`)

  if (!args.execute) {
    console.log('Dry run: nothing was deleted. Re-run with --execute to remove them all.')
    return
  }
  const failures = await removeFavorites(client, favorites, (done, total) => {
    process.stderr.write(`\rRemoving favorites… ${done}/${total}`)
  })
  process.stderr.write('\n')
  console.log(`Done: ${favorites.length - failures.length}/${favorites.length} favorites removed.`)
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
    console.log(`\nDry run: nothing was deleted. Re-run with "wipe --execute" to delete all ${totalItems} item(s) and ${ratings.length} rating(s). This is irreversible.`)
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

  console.log(`Done: ${totalItems + ratings.length - failures.length}/${totalItems + ratings.length} deletions succeeded.`)
  reportFailures(failures)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const client = new AppleMusicClient(loadConfig())
  if (args.command === 'wipe') await runWipe(client, args)
  else await runFavorites(client, args)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

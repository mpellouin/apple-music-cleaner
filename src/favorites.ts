import type { AppleMusicClient } from './client.js'

export interface FavoriteTrack {
  libraryId?: string
  catalogId?: string
  name: string
  artist: string
}

interface LibraryResource {
  id: string
  attributes?: {
    name?: string
    artistName?: string
    playParams?: { catalogId?: string; purchasedId?: string }
  }
}

interface RatingResource {
  id: string
  attributes?: { value?: number }
}

const FAVORITES_PLAYLIST_NAMES = new Set([
  'favorite songs',
  'favourite songs',
  'titres favoris',
  'morceaux favoris',
  'morceaux préférés',
  'canciones favoritas',
  'lieblingssongs',
])

function toTrack(res: LibraryResource): FavoriteTrack {
  return {
    libraryId: res.id,
    catalogId: res.attributes?.playParams?.catalogId,
    name: res.attributes?.name ?? '(unknown title)',
    artist: res.attributes?.artistName ?? '(unknown artist)',
  }
}

export async function findFavoritesPlaylistId(
  client: AppleMusicClient,
  nameOverride?: string,
): Promise<string | null> {
  for await (const pl of client.paginate<LibraryResource>('/v1/me/library/playlists?limit=100')) {
    const name = pl.attributes?.name?.toLowerCase()
    if (!name) continue
    if (nameOverride ? name === nameOverride.toLowerCase() : FAVORITES_PLAYLIST_NAMES.has(name)) {
      return pl.id
    }
  }
  return null
}

export async function favoritesFromPlaylist(
  client: AppleMusicClient,
  playlistId: string,
): Promise<FavoriteTrack[]> {
  const tracks: FavoriteTrack[] = []
  for await (const t of client.paginate<LibraryResource>(
    `/v1/me/library/playlists/${playlistId}/tracks?limit=100`,
  )) {
    tracks.push(toTrack(t))
  }
  return tracks
}

export async function favoritesFromScan(client: AppleMusicClient): Promise<FavoriteTrack[]> {
  const favorites: FavoriteTrack[] = []
  let batch: FavoriteTrack[] = []
  let scanned = 0
  for await (const song of client.paginate<LibraryResource>('/v1/me/library/songs?limit=100')) {
    batch.push(toTrack(song))
    if (batch.length === 100) {
      favorites.push(...(await filterFavorited(client, batch)))
      scanned += batch.length
      process.stderr.write(`\rScanned ${scanned} library songs, ${favorites.length} favorites so far…`)
      batch = []
    }
  }
  if (batch.length > 0) favorites.push(...(await filterFavorited(client, batch)))
  process.stderr.write('\n')
  return favorites
}

async function filterFavorited(
  client: AppleMusicClient,
  tracks: FavoriteTrack[],
): Promise<FavoriteTrack[]> {
  const ids = tracks.map((t) => t.libraryId).filter((id): id is string => Boolean(id))
  const { body } = await client.request<{ data?: RatingResource[] }>(
    'GET',
    `/v1/me/ratings/library-songs?ids=${ids.map(encodeURIComponent).join(',')}`,
  )
  const favorited = new Set(
    (body?.data ?? []).filter((r) => r.attributes?.value === 1).map((r) => r.id),
  )
  return tracks.filter((t) => t.libraryId && favorited.has(t.libraryId))
}

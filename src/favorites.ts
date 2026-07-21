import type { AppleMusicClient } from './client.js'

export interface FavoriteTrack {
  libraryId?: string
  catalogId?: string
  purchasedId?: string
  albumLibraryId?: string
  dateAdded?: string
  name: string
  artist: string
}

interface LibraryResource {
  id: string
  attributes?: {
    name?: string
    artistName?: string
    dateAdded?: string
    playParams?: { catalogId?: string; purchasedId?: string }
  }
  relationships?: {
    albums?: { data?: { id: string }[] }
  }
}

interface RatingResource {
  id: string
  attributes?: { value?: number }
}

export const RATING_FAVORITE = 1
export const RATING_DISLIKE = -1

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
    purchasedId: res.attributes?.playParams?.purchasedId,
    albumLibraryId: res.relationships?.albums?.data?.[0]?.id,
    dateAdded: res.attributes?.dateAdded,
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

async function filterRated(
  client: AppleMusicClient,
  tracks: FavoriteTrack[],
  wantValue: number,
): Promise<FavoriteTrack[]> {
  const ids = tracks.map((t) => t.libraryId).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []
  const { body } = await client.request<{ data?: RatingResource[] }>(
    'GET',
    `/v1/me/ratings/library-songs?ids=${ids.map(encodeURIComponent).join(',')}`,
  )
  const rated = new Set(
    (body?.data ?? []).filter((r) => r.attributes?.value === wantValue).map((r) => r.id),
  )
  return tracks.filter((t) => t.libraryId && rated.has(t.libraryId))
}

async function scanRatedSongs(
  client: AppleMusicClient,
  wantValue: number,
  label: string,
): Promise<FavoriteTrack[]> {
  const matched: FavoriteTrack[] = []
  let batch: FavoriteTrack[] = []
  let scanned = 0
  for await (const song of client.paginate<LibraryResource>(
    '/v1/me/library/songs?limit=100&include=albums',
  )) {
    batch.push(toTrack(song))
    if (batch.length === 100) {
      matched.push(...(await filterRated(client, batch, wantValue)))
      scanned += batch.length
      process.stderr.write(`\rScanned ${scanned} library songs, ${matched.length} ${label} so far…`)
      batch = []
    }
  }
  if (batch.length > 0) matched.push(...(await filterRated(client, batch, wantValue)))
  process.stderr.write('\n')
  return matched
}

export async function favoritesFromScan(client: AppleMusicClient): Promise<FavoriteTrack[]> {
  return scanRatedSongs(client, RATING_FAVORITE, 'favorites')
}

export async function dislikesFromScan(client: AppleMusicClient): Promise<FavoriteTrack[]> {
  return scanRatedSongs(client, RATING_DISLIKE, 'dislikes')
}

export async function filterFavorited(
  client: AppleMusicClient,
  tracks: FavoriteTrack[],
): Promise<FavoriteTrack[]> {
  return filterRated(client, tracks, RATING_FAVORITE)
}

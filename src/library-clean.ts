import type { AppleMusicClient } from './client.js'
import type { FavoriteTrack } from './favorites.js'
import { trackKeepKey } from './keep-file.js'
import type { WipeItem } from './wipe.js'

/** Favorites sharing the same catalog id or normalized artist+title (keep earliest, mark rest). */
export function findDuplicateFavorites(tracks: FavoriteTrack[]): FavoriteTrack[] {
  const seen = new Map<string, FavoriteTrack>()
  const duplicates: FavoriteTrack[] = []
  for (const track of tracks) {
    const key = track.catalogId ?? trackKeepKey(track.artist, track.name)
    if (seen.has(key)) duplicates.push(track)
    else seen.set(key, track)
  }
  return duplicates
}

/** Favorited tracks whose album is no longer in the user's library. */
export function findOrphanAlbumFavorites(
  tracks: FavoriteTrack[],
  libraryAlbumIds: Set<string>,
): FavoriteTrack[] {
  return tracks.filter(
    (t) => t.albumLibraryId !== undefined && !libraryAlbumIds.has(t.albumLibraryId),
  )
}

export async function listEmptyPlaylists(client: AppleMusicClient): Promise<WipeItem[]> {
  const empty: WipeItem[] = []
  for await (const pl of client.paginate<{
    id: string
    attributes?: { name?: string; curatorName?: string }
  }>('/v1/me/library/playlists?limit=100')) {
    let trackCount = 0
    for await (const _ of client.paginate(
      `/v1/me/library/playlists/${pl.id}/tracks?limit=100`,
    )) {
      trackCount++
      if (trackCount > 0) break
    }
    if (trackCount === 0) {
      empty.push({
        id: pl.id,
        label: pl.attributes?.name ?? pl.attributes?.curatorName ?? '(unnamed playlist)',
      })
    }
  }
  return empty
}

import type { AppleMusicClient } from './client.js'
import type { FavoriteTrack } from './favorites.js'

export interface RemovalFailure {
  track: FavoriteTrack
  error: string
}

async function removeOne(client: AppleMusicClient, track: FavoriteTrack): Promise<void> {
  if (track.libraryId) {
    const { status } = await client.request('DELETE', `/v1/me/ratings/library-songs/${encodeURIComponent(track.libraryId)}`)
    if (status !== 404) return
  }
  if (track.catalogId) {
    await client.request('DELETE', `/v1/me/ratings/songs/${encodeURIComponent(track.catalogId)}`)
    return
  }
  if (!track.libraryId) throw new Error('track has no usable id')
}

export async function removeFavorites(
  client: AppleMusicClient,
  tracks: FavoriteTrack[],
  onProgress: (done: number, total: number) => void,
): Promise<RemovalFailure[]> {
  const failures: RemovalFailure[] = []
  let done = 0
  const CHUNK = 5
  for (let i = 0; i < tracks.length; i += CHUNK) {
    const chunk = tracks.slice(i, i + CHUNK)
    const results = await Promise.allSettled(chunk.map((t) => removeOne(client, t)))
    results.forEach((r, j) => {
      if (r.status === 'rejected') {
        failures.push({ track: chunk[j], error: String(r.reason?.message ?? r.reason) })
      }
    })
    done += chunk.length
    onProgress(done, tracks.length)
  }
  return failures
}

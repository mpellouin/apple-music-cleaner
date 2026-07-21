import type { AppleMusicClient } from './client.js'

interface RecentTrack {
  id: string
  attributes?: { name?: string; artistName?: string }
}

const PAGE_SIZE = 30

/** Paginate `/v1/me/recent/played/tracks` and collect catalog song ids. */
export async function fetchRecentPlayedCatalogIds(
  client: AppleMusicClient,
  onProgress?: (fetched: number) => void,
): Promise<Set<string>> {
  const played = new Set<string>()
  let offset = 0

  while (true) {
    const { body } = await client.request<{ data?: RecentTrack[] }>(
      'GET',
      `/v1/me/recent/played/tracks?limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const tracks = body?.data ?? []
    if (tracks.length === 0) break

    for (const track of tracks) played.add(track.id)
    offset += tracks.length
    onProgress?.(offset)

    if (tracks.length < PAGE_SIZE) break
  }

  return played
}

export interface HistoryProbe {
  trackCount: number
  uniqueCatalogIds: number
  sample: { name: string; artist: string }[]
}

/** Summarize how much recent-played history the API exposes (for R&D / debugging). */
export async function probeRecentHistory(client: AppleMusicClient): Promise<HistoryProbe> {
  const ids = await fetchRecentPlayedCatalogIds(client)
  const sample: HistoryProbe['sample'] = []
  let offset = 0

  while (sample.length < 5) {
    const { body } = await client.request<{ data?: RecentTrack[] }>(
      'GET',
      `/v1/me/recent/played/tracks?limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const tracks = body?.data ?? []
    if (tracks.length === 0) break
    for (const t of tracks) {
      if (sample.length >= 5) break
      sample.push({
        name: t.attributes?.name ?? '(unknown)',
        artist: t.attributes?.artistName ?? '(unknown)',
      })
    }
    offset += tracks.length
    if (tracks.length < PAGE_SIZE) break
  }

  return {
    trackCount: offset,
    uniqueCatalogIds: ids.size,
    sample,
  }
}

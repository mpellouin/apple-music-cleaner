import type { AppleMusicClient } from './client.js'

interface DatedResource {
  id: string
  attributes?: { dateAdded?: string; name?: string; artistName?: string }
}

const PAGE_SIZE = 30

export function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime()
  if (Number.isNaN(then)) return NaN
  return (Date.now() - then) / (24 * 60 * 60 * 1000)
}

export function isAddedBefore(isoDate: string | undefined, days: number): boolean {
  if (!isoDate) return false
  const age = daysSince(isoDate)
  return Number.isFinite(age) && age >= days
}

/** Paginate recently-added library resources and collect library song ids. */
export async function fetchRecentlyAddedLibrarySongIds(
  client: AppleMusicClient,
): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  while (true) {
    const { body } = await client.request<{ data?: DatedResource[] }>(
      'GET',
      `/v1/me/library/recently-added?types=library-songs&limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const items = body?.data ?? []
    if (items.length === 0) break
    for (const item of items) ids.add(item.id)
    offset += items.length
    if (items.length < PAGE_SIZE) break
  }
  return ids
}

export interface AddedProbe {
  count: number
  sample: { name: string; artist: string; dateAdded?: string }[]
}

export async function probeRecentlyAdded(client: AppleMusicClient): Promise<AddedProbe> {
  const sample: AddedProbe['sample'] = []
  let offset = 0
  while (sample.length < 5) {
    const { body } = await client.request<{ data?: DatedResource[] }>(
      'GET',
      `/v1/me/library/recently-added?types=library-songs&limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const items = body?.data ?? []
    if (items.length === 0) break
    for (const item of items) {
      if (sample.length >= 5) break
      sample.push({
        name: item.attributes?.name ?? '(unknown)',
        artist: item.attributes?.artistName ?? '(unknown)',
        dateAdded: item.attributes?.dateAdded,
      })
    }
    offset += items.length
    if (items.length < PAGE_SIZE) break
  }
  return { count: offset, sample }
}

export async function fetchLibraryAlbumIds(client: AppleMusicClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for await (const album of client.paginate<{ id: string }>('/v1/me/library/albums?limit=100')) {
    ids.add(album.id)
  }
  return ids
}

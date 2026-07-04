import type { AppleMusicClient } from './client.js'

export interface WipeItem {
  id: string
  catalogId?: string
  label: string
}

export interface CategoryDef {
  key: string
  listPath: string
  libraryRatingType: string
  catalogRatingType: string
}

// Deletion order matters: playlists and albums go before songs so that
// container deletions don't race against the songs they contain.
export const CATEGORIES: CategoryDef[] = [
  {
    key: 'playlists',
    listPath: '/v1/me/library/playlists',
    libraryRatingType: 'library-playlists',
    catalogRatingType: 'playlists',
  },
  {
    key: 'albums',
    listPath: '/v1/me/library/albums',
    libraryRatingType: 'library-albums',
    catalogRatingType: 'albums',
  },
  {
    key: 'music videos',
    listPath: '/v1/me/library/music-videos',
    libraryRatingType: 'library-music-videos',
    catalogRatingType: 'music-videos',
  },
  {
    key: 'songs',
    listPath: '/v1/me/library/songs',
    libraryRatingType: 'library-songs',
    catalogRatingType: 'songs',
  },
]

interface LibraryResource {
  id: string
  attributes?: {
    name?: string
    artistName?: string
    curatorName?: string
    playParams?: { catalogId?: string }
  }
}

export interface Failure {
  label: string
  error: string
}

async function inChunks<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  label: (item: T) => string,
  onProgress?: (done: number, total: number) => void,
): Promise<Failure[]> {
  const failures: Failure[] = []
  let done = 0
  const CHUNK = 5
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const results = await Promise.allSettled(chunk.map(fn))
    results.forEach((r, j) => {
      if (r.status === 'rejected') {
        failures.push({ label: label(chunk[j]), error: String((r.reason as Error)?.message ?? r.reason) })
      }
    })
    done += chunk.length
    onProgress?.(done, items.length)
  }
  return failures
}

export async function listCategory(client: AppleMusicClient, cat: CategoryDef): Promise<WipeItem[]> {
  const items: WipeItem[] = []
  for await (const r of client.paginate<LibraryResource>(`${cat.listPath}?limit=100`)) {
    const a = r.attributes
    items.push({
      id: r.id,
      catalogId: a?.playParams?.catalogId,
      label: [a?.name ?? '(unnamed)', a?.artistName ?? a?.curatorName].filter(Boolean).join(' — '),
    })
  }
  return items
}

export async function ratedIds(
  client: AppleMusicClient,
  ratingType: string,
  ids: string[],
  wantValue?: number,
): Promise<string[]> {
  const rated: string[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const { body } = await client.request<{ data?: { id: string; attributes?: { value?: number } }[] }>(
      'GET',
      `/v1/me/ratings/${ratingType}?ids=${batch.map(encodeURIComponent).join(',')}`,
    )
    rated.push(
      ...(body?.data ?? [])
        .filter((r) => wantValue === undefined || r.attributes?.value === wantValue)
        .map((r) => r.id),
    )
  }
  return rated
}

export interface RatingTarget {
  ratingType: string
  id: string
}

export async function findRatings(
  client: AppleMusicClient,
  cat: CategoryDef,
  items: WipeItem[],
): Promise<RatingTarget[]> {
  const targets: RatingTarget[] = []
  const libRated = await ratedIds(client, cat.libraryRatingType, items.map((i) => i.id))
  targets.push(...libRated.map((id) => ({ ratingType: cat.libraryRatingType, id })))
  const catalogIds = [...new Set(items.map((i) => i.catalogId).filter((id): id is string => Boolean(id)))]
  const catRated = await ratedIds(client, cat.catalogRatingType, catalogIds)
  targets.push(...catRated.map((id) => ({ ratingType: cat.catalogRatingType, id })))
  return targets
}

export async function deleteRatings(
  client: AppleMusicClient,
  targets: RatingTarget[],
  onProgress?: (done: number, total: number) => void,
): Promise<Failure[]> {
  return inChunks(
    targets,
    (t) => client.request('DELETE', `/v1/me/ratings/${t.ratingType}/${encodeURIComponent(t.id)}`),
    (t) => `${t.ratingType}/${t.id}`,
    onProgress,
  )
}

export async function deleteItems(
  client: AppleMusicClient,
  cat: CategoryDef,
  items: WipeItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<Failure[]> {
  return inChunks(
    items,
    (item) => client.request('DELETE', `${cat.listPath}/${encodeURIComponent(item.id)}`),
    (item) => item.label,
    onProgress,
  )
}

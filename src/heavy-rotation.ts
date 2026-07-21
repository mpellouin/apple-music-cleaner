import type { AppleMusicClient } from './client.js'

interface CatalogResource {
  id: string
  attributes?: { name?: string; artistName?: string }
}

/** Fetch catalog song ids from Apple's heavy-rotation feed (may be empty on some accounts). */
export async function fetchHeavyRotationCatalogIds(client: AppleMusicClient): Promise<Set<string>> {
  const ids = new Set<string>()
  const { body } = await client.request<{ data?: CatalogResource[] }>(
    'GET',
    '/v1/me/history/heavy-rotation',
  )
  for (const item of body?.data ?? []) ids.add(item.id)
  return ids
}

export async function probeHeavyRotation(client: AppleMusicClient): Promise<{
  count: number
  sample: { name: string; artist: string }[]
}> {
  const { body } = await client.request<{ data?: CatalogResource[] }>(
    'GET',
    '/v1/me/history/heavy-rotation',
  )
  const data = body?.data ?? []
  return {
    count: data.length,
    sample: data.slice(0, 5).map((t) => ({
      name: t.attributes?.name ?? '(unknown)',
      artist: t.attributes?.artistName ?? '(unknown)',
    })),
  }
}

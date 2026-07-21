import { readFileSync, writeFileSync } from 'node:fs'
import type { AppleMusicClient } from './client.js'
import { CATEGORIES, listCategory, ratedIds } from './wipe.js'

export interface InventorySnapshot {
  version: 1
  capturedAt: string
  categories: Record<string, number>
  favorites: number
}

export async function captureSnapshot(client: AppleMusicClient): Promise<InventorySnapshot> {
  const categories: Record<string, number> = {}
  let songs: { id: string }[] = []
  for (const cat of CATEGORIES) {
    const items = await listCategory(client, cat)
    categories[cat.key] = items.length
    if (cat.key === 'songs') songs = items
  }
  const favIds = await ratedIds(client, 'library-songs', songs.map((s) => s.id), 1)
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    categories,
    favorites: favIds.length,
  }
}

export function saveSnapshot(path: string, snapshot: InventorySnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
}

export function loadSnapshot(path: string): InventorySnapshot {
  const snap = JSON.parse(readFileSync(path, 'utf8')) as InventorySnapshot
  if (snap.version !== 1) throw new Error('Unsupported snapshot version')
  return snap
}

export function compareSnapshots(before: InventorySnapshot, after: InventorySnapshot): string[] {
  const lines: string[] = []
  lines.push(`Before: ${before.capturedAt}`)
  lines.push(`After:  ${after.capturedAt}`)
  lines.push('')
  for (const key of Object.keys(before.categories)) {
    const delta = (after.categories[key] ?? 0) - (before.categories[key] ?? 0)
    const sign = delta > 0 ? '+' : ''
    lines.push(`  ${key}: ${before.categories[key]} → ${after.categories[key]} (${sign}${delta})`)
  }
  const favDelta = after.favorites - before.favorites
  lines.push(`  favorites: ${before.favorites} → ${after.favorites} (${favDelta > 0 ? '+' : ''}${favDelta})`)
  return lines
}

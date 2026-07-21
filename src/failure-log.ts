import { readFileSync, writeFileSync } from 'node:fs'
import type { AppleMusicClient } from './client.js'
import type { FavoriteTrack } from './favorites.js'
import { removeFavorites } from './remove.js'
import type { Failure, RatingTarget } from './wipe.js'
import { deleteRatings } from './wipe.js'

export interface FailureLogEntry {
  kind: 'rating' | 'favorite' | 'item'
  label: string
  error: string
  ratingType?: string
  id?: string
  listPath?: string
  track?: FavoriteTrack
}

export interface FailureLog {
  version: 1
  createdAt: string
  failures: FailureLogEntry[]
}

export function writeFailureLog(path: string, failures: FailureLogEntry[]): void {
  const log: FailureLog = { version: 1, createdAt: new Date().toISOString(), failures }
  writeFileSync(path, JSON.stringify(log, null, 2) + '\n', 'utf8')
}

export function readFailureLog(path: string): FailureLog {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as FailureLog
  if (parsed.version !== 1 || !Array.isArray(parsed.failures)) {
    throw new Error('Invalid failure log format')
  }
  return parsed
}

export function failuresToLogEntries(failures: Failure[], extra?: Partial<FailureLogEntry>): FailureLogEntry[] {
  return failures.map((f) => ({ kind: 'rating' as const, label: f.label, error: f.error, ...extra }))
}

export async function resumeFailureLog(
  client: AppleMusicClient,
  path: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Failure[]> {
  const log = readFailureLog(path)
  const remaining: Failure[] = []
  let done = 0

  const ratingTargets: RatingTarget[] = []
  const favoriteTracks: FavoriteTrack[] = []

  for (const entry of log.failures) {
    if (entry.kind === 'favorite' && entry.track) favoriteTracks.push(entry.track)
    else if (entry.kind === 'rating' && entry.ratingType && entry.id) {
      ratingTargets.push({ ratingType: entry.ratingType, id: entry.id })
    }
  }

  const total = ratingTargets.length + favoriteTracks.length

  if (ratingTargets.length > 0) {
    const results = await deleteRatings(client, ratingTargets, (d, t) => onProgress?.(done + d, total))
    remaining.push(...results)
    done += ratingTargets.length
  }

  if (favoriteTracks.length > 0) {
    const results = await removeFavorites(client, favoriteTracks, (d, t) => onProgress?.(done + d, total))
    remaining.push(
      ...results.map((f) => ({ label: `${f.track.name} — ${f.track.artist}`, error: f.error })),
    )
  }

  return remaining
}

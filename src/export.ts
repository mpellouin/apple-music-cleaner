import { writeFileSync } from 'node:fs'
import type { FavoriteTrack } from './favorites.js'
import type { TargetWithReason } from './rules.js'

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Write cleanup targets to a CSV file. */
export function exportTracksCsv(path: string, tracks: FavoriteTrack[]): void {
  exportTargetsCsv(
    path,
    tracks.map((track) => ({ track, reasons: [] })),
  )
}

/** Write cleanup targets with reasons to CSV. */
export function exportTargetsCsv(path: string, targets: TargetWithReason[]): void {
  const lines = ['artist,title,catalog_id,library_id,reasons']
  for (const { track, reasons } of targets) {
    lines.push(
      [
        track.artist,
        track.name,
        track.catalogId ?? '',
        track.libraryId ?? '',
        reasons.join('; '),
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

export function formatPreviewTable(targets: TargetWithReason[], limit = 20): string[] {
  const lines: string[] = []
  for (const { track, reasons } of targets.slice(0, limit)) {
    const why = reasons.length ? ` [${reasons.join('; ')}]` : ''
    lines.push(`  ${track.name} — ${track.artist}${why}`)
  }
  if (targets.length > limit) lines.push(`  … and ${targets.length - limit} more`)
  return lines
}

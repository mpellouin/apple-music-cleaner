import { writeFileSync } from 'node:fs'
import type { FavoriteTrack } from './favorites.js'

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Write cleanup targets to a CSV file (artist, title, catalog id, library id). */
export function exportTracksCsv(path: string, tracks: FavoriteTrack[]): void {
  const lines = ['artist,title,catalog_id,library_id']
  for (const t of tracks) {
    lines.push(
      [t.artist, t.name, t.catalogId ?? '', t.libraryId ?? ''].map(csvEscape).join(','),
    )
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

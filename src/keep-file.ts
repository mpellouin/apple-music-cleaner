import { readFileSync } from 'node:fs'

/** Load keep-list entries: catalog ids (as-is) or "artist — title" (lowercased). */
export function loadKeepFile(path: string): Set<string> {
  const entries = new Set<string>()
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^\d+$/.test(trimmed)) entries.add(trimmed)
    else entries.add(trimmed.toLowerCase())
  }
  return entries
}

export function trackKeepKey(artist: string, name: string): string {
  return `${artist} — ${name}`.toLowerCase()
}

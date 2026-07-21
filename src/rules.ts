import type { FavoriteTrack } from './favorites.js'
import { trackKeepKey } from './keep-file.js'

export interface CleanRules {
  /** Remove favorites whose catalog id does not appear in recent-played history. */
  noPlaysWithinDays?: number
  /** Case-insensitive substring match on artist name. */
  artist?: string
  /** Exclude tracks whose artist name contains this (case-insensitive). */
  excludeArtist?: string
  /** Match track title against this pattern. */
  titlePattern?: RegExp
  /** Catalog ids or "artist — title" keys that must never be removed. */
  keepEntries?: Set<string>
  /** Skip purchased tracks (have a purchasedId). */
  excludePurchased?: boolean
}

export interface RuleSelection {
  targets: FavoriteTrack[]
  skippedNoCatalogId: number
  skippedPurchased: number
  skippedKeepList: number
}

function isKept(track: FavoriteTrack, keep: Set<string>): boolean {
  if (track.catalogId && keep.has(track.catalogId)) return true
  return keep.has(trackKeepKey(track.artist, track.name))
}

export function applyFavoriteRules(
  favorites: FavoriteTrack[],
  rules: CleanRules,
  playedCatalogIds?: Set<string>,
): RuleSelection {
  let targets = favorites
  let skippedPurchased = 0
  let skippedKeepList = 0
  let skippedNoCatalogId = 0

  if (rules.excludePurchased) {
    const before = targets.length
    targets = targets.filter((t) => !t.purchasedId)
    skippedPurchased = before - targets.length
  }

  if (rules.artist) {
    const needle = rules.artist.toLowerCase()
    targets = targets.filter((t) => t.artist.toLowerCase().includes(needle))
  }

  if (rules.excludeArtist) {
    const needle = rules.excludeArtist.toLowerCase()
    targets = targets.filter((t) => !t.artist.toLowerCase().includes(needle))
  }

  if (rules.titlePattern) {
    targets = targets.filter((t) => rules.titlePattern!.test(t.name))
  }

  if (rules.keepEntries && rules.keepEntries.size > 0) {
    const before = targets.length
    targets = targets.filter((t) => !isKept(t, rules.keepEntries!))
    skippedKeepList = before - targets.length
  }

  if (rules.noPlaysWithinDays !== undefined) {
    if (!playedCatalogIds) {
      throw new Error('playedCatalogIds required when noPlaysWithinDays is set')
    }
    const noCatalog = targets.filter((t) => !t.catalogId)
    skippedNoCatalogId = noCatalog.length
    targets = targets.filter(
      (t) => t.catalogId !== undefined && !playedCatalogIds.has(t.catalogId),
    )
  }

  return { targets, skippedNoCatalogId, skippedPurchased, skippedKeepList }
}

export function describeRules(rules: CleanRules): string[] {
  const parts: string[] = []
  if (rules.noPlaysWithinDays !== undefined) {
    parts.push(`no play in recent history (~${rules.noPlaysWithinDays}d; API may expose less)`)
  }
  if (rules.artist) parts.push(`artist contains "${rules.artist}"`)
  if (rules.excludeArtist) parts.push(`artist does not contain "${rules.excludeArtist}"`)
  if (rules.titlePattern) parts.push(`title matches ${rules.titlePattern}`)
  if (rules.keepEntries?.size) parts.push(`keep-list (${rules.keepEntries.size} entries)`)
  if (rules.excludePurchased) parts.push('exclude purchased')
  return parts
}

/** @deprecated use applyFavoriteRules */
export function selectFavoritesForRemoval(
  favorites: FavoriteTrack[],
  playedCatalogIds: Set<string>,
  rules: CleanRules,
): RuleSelection {
  return applyFavoriteRules(favorites, rules, playedCatalogIds)
}

/** @deprecated use describeRules */
export function describeRule(rules: CleanRules): string | null {
  const parts = describeRules(rules)
  return parts.length > 0 ? parts.join('; ') : null
}

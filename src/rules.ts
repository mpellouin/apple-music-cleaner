import type { FavoriteTrack } from './favorites.js'

export interface CleanRules {
  /** Remove favorites whose catalog id does not appear in recent-played history. */
  noPlaysWithinDays?: number
}

export interface RuleSelection {
  targets: FavoriteTrack[]
  skippedNoCatalogId: number
}

export function selectFavoritesForRemoval(
  favorites: FavoriteTrack[],
  playedCatalogIds: Set<string>,
  rules: CleanRules,
): RuleSelection {
  if (rules.noPlaysWithinDays === undefined) {
    return { targets: favorites, skippedNoCatalogId: 0 }
  }

  const noCatalogId = favorites.filter((t) => !t.catalogId)
  const targets = favorites.filter(
    (t) => t.catalogId !== undefined && !playedCatalogIds.has(t.catalogId),
  )

  return { targets, skippedNoCatalogId: noCatalogId.length }
}

export function describeRule(rules: CleanRules): string | null {
  if (rules.noPlaysWithinDays !== undefined) {
    return `no play in recent history (~${rules.noPlaysWithinDays}d window; API may expose less)`
  }
  return null
}

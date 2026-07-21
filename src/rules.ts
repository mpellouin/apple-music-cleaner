import type { FavoriteTrack } from './favorites.js'
import { findDuplicateFavorites, findOrphanAlbumFavorites } from './library-clean.js'
import { isAddedBefore } from './library-meta.js'
import { trackKeepKey } from './keep-file.js'
import type { RuleContext } from './cleanup-context.js'

export interface CleanRules {
  noPlaysWithinDays?: number
  neverPlayed?: boolean
  addedBeforeDays?: number
  artist?: string
  excludeArtist?: string
  titlePattern?: RegExp
  keepEntries?: Set<string>
  excludePurchased?: boolean
  duplicatesOnly?: boolean
  orphanAlbumOnly?: boolean
  outsideHeavyRotation?: boolean
}

export interface TargetWithReason {
  track: FavoriteTrack
  reasons: string[]
}

export interface RuleSelection {
  targets: FavoriteTrack[]
  targetsWithReasons: TargetWithReason[]
  skippedNoCatalogId: number
  skippedPurchased: number
  skippedKeepList: number
}

function isKept(track: FavoriteTrack, keep: Set<string>): boolean {
  if (track.catalogId && keep.has(track.catalogId)) return true
  return keep.has(trackKeepKey(track.artist, track.name))
}

function matchesRules(
  track: FavoriteTrack,
  rules: CleanRules,
  ctx: RuleContext,
): string[] {
  const reasons: string[] = []

  if (rules.excludePurchased && track.purchasedId) return []

  if (rules.artist && !track.artist.toLowerCase().includes(rules.artist.toLowerCase())) return []
  if (rules.artist) reasons.push(`artist contains "${rules.artist}"`)

  if (rules.excludeArtist && track.artist.toLowerCase().includes(rules.excludeArtist.toLowerCase())) {
    return []
  }

  if (rules.titlePattern && !rules.titlePattern.test(track.name)) return []
  if (rules.titlePattern) reasons.push(`title matches ${rules.titlePattern}`)

  if (rules.keepEntries?.size && isKept(track, rules.keepEntries)) return []

  if (rules.addedBeforeDays !== undefined) {
    if (!isAddedBefore(track.dateAdded, rules.addedBeforeDays)) return []
    reasons.push(`added more than ${rules.addedBeforeDays}d ago`)
  }

  const needsPlayData = rules.noPlaysWithinDays !== undefined || rules.neverPlayed
  if (needsPlayData) {
    if (!track.catalogId) return []
    if (!ctx.playedCatalogIds?.has(track.catalogId)) {
      if (rules.noPlaysWithinDays !== undefined) {
        reasons.push(`no play in recent history (~${rules.noPlaysWithinDays}d)`)
      } else {
        reasons.push('never played (not in recent-played feed)')
      }
    } else {
      return []
    }
  }

  if (rules.outsideHeavyRotation) {
    if (!track.catalogId) return []
    if (ctx.heavyRotationCatalogIds?.has(track.catalogId)) return []
    reasons.push('outside heavy-rotation feed')
  }

  if (rules.orphanAlbumOnly) {
    if (!track.albumLibraryId || ctx.libraryAlbumIds?.has(track.albumLibraryId)) return []
    reasons.push('album no longer in library')
  }

  if (reasons.length === 0 && Object.keys(rules).length === 0) reasons.push('matched')

  return reasons
}

export function applyFavoriteRules(
  favorites: FavoriteTrack[],
  rules: CleanRules,
  ctx: RuleContext = {},
): RuleSelection {
  let pool = favorites

  if (rules.duplicatesOnly) {
    pool = findDuplicateFavorites(favorites)
  }

  if (rules.orphanAlbumOnly && ctx.libraryAlbumIds) {
    pool = findOrphanAlbumFavorites(pool, ctx.libraryAlbumIds)
  }

  let skippedPurchased = 0
  let skippedKeepList = 0
  let skippedNoCatalogId = 0

  if (rules.excludePurchased) {
    const before = pool.length
    pool = pool.filter((t) => !t.purchasedId)
    skippedPurchased = before - pool.length
  }

  const hasExplicitFilters =
    rules.artist !== undefined ||
    rules.excludeArtist !== undefined ||
    rules.titlePattern !== undefined ||
    rules.addedBeforeDays !== undefined ||
    rules.noPlaysWithinDays !== undefined ||
    rules.neverPlayed ||
    rules.outsideHeavyRotation ||
    rules.keepEntries !== undefined ||
    rules.duplicatesOnly ||
    rules.orphanAlbumOnly

  const targetsWithReasons: TargetWithReason[] = []

  for (const track of pool) {
    if (rules.keepEntries?.size && isKept(track, rules.keepEntries)) {
      skippedKeepList++
      continue
    }

    let reasons = hasExplicitFilters ? matchesRules(track, rules, ctx) : ['all favorites']
    if (reasons.length === 0 && rules.duplicatesOnly) reasons = ['duplicate entry']
    if (reasons.length === 0 && rules.orphanAlbumOnly) reasons = ['orphan album']
    if (reasons.length === 0) continue

    if (
      (rules.noPlaysWithinDays !== undefined || rules.neverPlayed || rules.outsideHeavyRotation) &&
      !track.catalogId
    ) {
      skippedNoCatalogId++
      continue
    }

    targetsWithReasons.push({ track, reasons })
  }

  return {
    targets: targetsWithReasons.map((t) => t.track),
    targetsWithReasons,
    skippedNoCatalogId,
    skippedPurchased,
    skippedKeepList,
  }
}

export function describeRules(rules: CleanRules): string[] {
  const parts: string[] = []
  if (rules.noPlaysWithinDays !== undefined) {
    parts.push(`no play in recent history (~${rules.noPlaysWithinDays}d; API may expose less)`)
  }
  if (rules.neverPlayed) parts.push('never played (not in recent-played feed)')
  if (rules.addedBeforeDays !== undefined) parts.push(`added more than ${rules.addedBeforeDays}d ago`)
  if (rules.artist) parts.push(`artist contains "${rules.artist}"`)
  if (rules.excludeArtist) parts.push(`artist does not contain "${rules.excludeArtist}"`)
  if (rules.titlePattern) parts.push(`title matches ${rules.titlePattern}`)
  if (rules.keepEntries?.size) parts.push(`keep-list (${rules.keepEntries.size} entries)`)
  if (rules.excludePurchased) parts.push('exclude purchased')
  if (rules.duplicatesOnly) parts.push('duplicates only')
  if (rules.orphanAlbumOnly) parts.push('orphan album favorites')
  if (rules.outsideHeavyRotation) parts.push('outside heavy-rotation feed')
  return parts
}

export function mergeRules(base: CleanRules, overlay: CleanRules): CleanRules {
  return { ...base, ...overlay, keepEntries: overlay.keepEntries ?? base.keepEntries }
}

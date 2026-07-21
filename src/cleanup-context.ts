import type { AppleMusicClient } from './client.js'
import { fetchHeavyRotationCatalogIds } from './heavy-rotation.js'
import { fetchRecentPlayedCatalogIds } from './history.js'
import { fetchLibraryAlbumIds } from './library-meta.js'
import type { CleanRules } from './rules.js'

export interface RuleContext {
  playedCatalogIds?: Set<string>
  heavyRotationCatalogIds?: Set<string>
  libraryAlbumIds?: Set<string>
}

export async function buildRuleContext(
  client: AppleMusicClient,
  rules: CleanRules,
  onStatus?: (msg: string) => void,
): Promise<RuleContext> {
  const ctx: RuleContext = {}

  if (rules.noPlaysWithinDays !== undefined || rules.neverPlayed) {
    onStatus?.('Loading recent-played history…')
    ctx.playedCatalogIds = await fetchRecentPlayedCatalogIds(client)
  }

  if (rules.outsideHeavyRotation) {
    onStatus?.('Loading heavy-rotation feed…')
    ctx.heavyRotationCatalogIds = await fetchHeavyRotationCatalogIds(client)
  }

  if (rules.orphanAlbumOnly) {
    onStatus?.('Loading library albums…')
    ctx.libraryAlbumIds = await fetchLibraryAlbumIds(client)
  }

  return ctx
}

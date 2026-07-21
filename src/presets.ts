import type { CleanRules } from './rules.js'

export interface CleanupPreset {
  description: string
  rules: CleanRules
}

export const BUILTIN_PRESETS: Record<string, CleanupPreset> = {
  'stale-favorites': {
    description: 'Remove favorites with no recent play (~90 days)',
    rules: { noPlaysWithinDays: 90 },
  },
  'spring-clean': {
    description: 'Stale favorites (180d) excluding purchased tracks',
    rules: { noPlaysWithinDays: 180, excludePurchased: true },
  },
  duplicates: {
    description: 'Remove duplicate favorite entries (same catalog id or title)',
    rules: { duplicatesOnly: true },
  },
  'orphan-albums': {
    description: 'Remove favorites whose album is no longer in the library',
    rules: { orphanAlbumOnly: true },
  },
  'outside-heavy-rotation': {
    description: 'Remove favorites not in Apple heavy-rotation feed',
    rules: { outsideHeavyRotation: true },
  },
  'old-favorites': {
    description: 'Remove favorites added more than 365 days ago',
    rules: { addedBeforeDays: 365 },
  },
}

export function resolvePreset(name: string): CleanRules {
  const preset = BUILTIN_PRESETS[name]
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Available: ${Object.keys(BUILTIN_PRESETS).join(', ')}`)
  }
  return { ...preset.rules }
}

export function listPresets(): { name: string; description: string }[] {
  return Object.entries(BUILTIN_PRESETS).map(([name, p]) => ({ name, description: p.description }))
}

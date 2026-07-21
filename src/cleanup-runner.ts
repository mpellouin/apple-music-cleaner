import type { AppleMusicClient } from './client.js'
import { buildRuleContext } from './cleanup-context.js'
import { exportTargetsCsv, formatPreviewTable } from './export.js'
import type { FavoriteTrack } from './favorites.js'
import { writeFailureLog } from './failure-log.js'
import { resolvePreset } from './presets.js'
import { removeFavorites } from './remove.js'
import { applyFavoriteRules, describeRules, mergeRules, type CleanRules } from './rules.js'
import type { Failure } from './wipe.js'

export interface RatedCleanupOptions {
  rules: CleanRules
  execute: boolean
  exportPath?: string
  failureLogPath?: string
  verbose: boolean
}

export function printSelectionSummary(
  total: number,
  selection: ReturnType<typeof applyFavoriteRules>,
  rules: CleanRules,
): void {
  const labels = describeRules(rules)
  if (labels.length > 0) {
    console.log('Rules: ' + labels.join('; '))
  }
  console.log(`  ${total} track(s) in scope`)
  console.log(`  ${selection.targets.length} selected for removal`)
  if (selection.skippedPurchased > 0) {
    console.log(`  ${selection.skippedPurchased} skipped (purchased)`)
  }
  if (selection.skippedKeepList > 0) {
    console.log(`  ${selection.skippedKeepList} skipped (keep-list)`)
  }
  if (selection.skippedNoCatalogId > 0) {
    console.log(`  ${selection.skippedNoCatalogId} skipped (no catalog id — cannot match play/history rules)`)
  }
}

export async function runRatedCleanup(
  client: AppleMusicClient,
  tracks: FavoriteTrack[],
  actionLabel: string,
  options: RatedCleanupOptions,
): Promise<void> {
  if (tracks.length === 0) {
    console.log(`No ${actionLabel} tracks found. Nothing to do.`)
    return
  }

  const ctx = await buildRuleContext(client, options.rules, (msg) => {
    process.stderr.write(msg)
  })
  process.stderr.write('\n')

  const selection = applyFavoriteRules(tracks, options.rules, ctx)
  printSelectionSummary(tracks.length, selection, options.rules)

  if (selection.targets.length === 0) {
    console.log('No tracks match the cleanup rules. Nothing to do.')
    return
  }

  const lines = formatPreviewTable(selection.targetsWithReasons, options.verbose ? 10_000 : 20)
  for (const line of lines) console.log(line)
  console.log(`\n${selection.targets.length} track(s) selected.`)

  if (options.exportPath) {
    exportTargetsCsv(options.exportPath, selection.targetsWithReasons)
    console.log(`Exported to ${options.exportPath}`)
  }

  if (!options.execute) {
    console.log('Dry run: nothing was deleted. Re-run with --execute to remove them.')
    return
  }

  const failures = await removeFavorites(client, selection.targets, (done, total) => {
    process.stderr.write(`\rRemoving ${actionLabel}… ${done}/${total}`)
  })
  process.stderr.write('\n')
  console.log(`Done: ${selection.targets.length - failures.length}/${selection.targets.length} removed.`)

  if (failures.length > 0) {
    const mapped: Failure[] = failures.map((f) => ({
      label: `${f.track.name} — ${f.track.artist}`,
      error: f.error,
    }))
    for (const f of mapped) console.error(`  ${f.label}: ${f.error}`)
    if (options.failureLogPath) {
      writeFailureLog(
        options.failureLogPath,
        failures.map((f) => ({
          kind: 'favorite' as const,
          label: `${f.track.name} — ${f.track.artist}`,
          error: f.error,
          track: f.track,
        })),
      )
      console.error(`Failures written to ${options.failureLogPath} — retry with: npm start -- resume ${options.failureLogPath}`)
    }
    process.exitCode = 1
  }
}

export function rulesFromPresetAndArgs(base: CleanRules, preset?: string): CleanRules {
  if (!preset) return base
  return mergeRules(resolvePreset(preset), base)
}

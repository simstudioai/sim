#!/usr/bin/env bun

/**
 * CI check: validates every declared canvas sentence against the block it
 * describes, and reports operation coverage.
 *
 * A canvas sentence replaces a card's field rows with prose. A broken one drops
 * a clause, or resolves to nothing at all, with nothing thrown and nothing
 * logged — and a card with no sentence and no filled rows paints a bare header.
 * The invariants live in `lib/workflows/blocks/canvas-sentence-validation.ts`;
 * this is the CLI over them, plus a run of the real resolver against the card a
 * user first sees.
 *
 * Usage:
 *   bun run apps/sim/scripts/check-canvas-sentences.ts
 *   bun run apps/sim/scripts/check-canvas-sentences.ts --block=slack
 *   bun run apps/sim/scripts/check-canvas-sentences.ts --require-coverage
 *   bun run apps/sim/scripts/check-canvas-sentences.ts --block=slack --render
 *
 * `--block` scopes to one registry entry, so an authoring agent can verify its
 * own file without running the fleet. `--require-coverage` promotes the
 * coverage report from a progress meter to a hard failure — leave it off until
 * the rollout completes. `--render` prints each sentence as the card reads it,
 * which is the only way to review prose at this volume.
 */

import {
  getCardSubBlocks,
  getSeededSubBlockValues,
} from '@/lib/workflows/blocks/canvas-card-fields'
import {
  type CardSelector,
  getOperationSubBlockId,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
import { renderSentenceReadings } from '@/lib/workflows/blocks/canvas-sentence-render'
import {
  TRIGGER_SENTENCE_EXEMPT_TYPES,
  validateBlockSentences,
  validateTriggerSentence,
} from '@/lib/workflows/blocks/canvas-sentence-validation'
import { getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

const args = process.argv.slice(2)
const blockFilter = args.find((arg) => arg.startsWith('--block='))?.slice('--block='.length)
const requireCoverage = args.includes('--require-coverage')
const render = args.includes('--render')

const entries = Object.entries(getBlockRegistry()).filter(
  ([type]) => !blockFilter || type === blockFilter
)

if (blockFilter && entries.length === 0) {
  console.error(`✗ No block registered as "${blockFilter}".`)
  process.exit(1)
}

let failureCount = 0
let coveredOperations = 0
let totalOperations = 0
const incomplete: Array<{ blockType: string; missing: string[] }> = []
const failureLines: string[] = []
const paintsNothing: string[] = []

/**
 * Runs the real resolver against a card as a user first sees it.
 *
 * The rules above are a *model* of what `resolveCanvasSentence` does, and the
 * two drifting apart is the whole reason this check exists: the model once
 * reported every sentence healthy while 3,146 of 4,583 cards painted nothing.
 *
 * The premise matters as much as the resolver. An earlier version of this
 * function asserted every subblock was on the card — more permissive than any
 * card that can exist — so it re-stated the model's own blind spot and passed
 * green on 35 sentences that paint nothing. It now builds the on-card set from
 * `getCardSubBlocks`, the same function the canvas itself filters with, for a
 * fresh block: basic mode, no values beyond the operation.
 */
function paintsOnEmptyCard(
  config: BlockConfig,
  operationSubBlockId: string | null,
  card: CardSelector
): boolean {
  /* A fresh card holds every subblock's seeded default, not just the operation. */
  const values = getSeededSubBlockValues(config)
  if (card.mode === 'action' && operationSubBlockId) {
    values[operationSubBlockId] = card.operationValue
  }

  const onCardById = new Map<string, SubBlockConfig>()
  for (const subBlock of getCardSubBlocks(config, {
    advanced: false,
    values,
    triggerMode: card.mode === 'trigger',
  })) {
    if (!onCardById.has(subBlock.id)) onCardById.set(subBlock.id, subBlock)
  }

  const segments = resolveCanvasSentence(
    config,
    card,
    () => false,
    (subBlockId) => onCardById.get(subBlockId) ?? null
  )
  if (!segments) return false
  return segments.some((segment) =>
    typeof segment === 'string' ? segment.trim().length > 0 : Boolean(segment.noun)
  )
}

/** The operation a freshly-dropped block holds, per `prepareBlockState`. */
function seededOperationValue(config: BlockConfig, operationSubBlockId: string | null): unknown {
  if (!operationSubBlockId) return undefined
  const subBlock = config.subBlocks.find((candidate) => candidate.id === operationSubBlockId)
  if (!subBlock) return undefined
  if (typeof subBlock.value === 'function') {
    try {
      return subBlock.value({})
    } catch {
      return undefined
    }
  }
  return subBlock.defaultValue
}

for (const [blockType, config] of entries) {
  const { failures, coverage } = validateBlockSentences(config)

  /*
   * Every trigger a block can run under. A trigger card paints its own sentence
   * — declared, or derived from the trigger's registry name — so each one is a
   * card state that has to say something.
   */
  const availableTriggers =
    config.triggers?.enabled && !TRIGGER_SENTENCE_EXEMPT_TYPES.has(blockType)
      ? (config.triggers.available ?? [])
      : []
  for (const triggerId of availableTriggers) {
    const triggerName = TRIGGER_REGISTRY[triggerId]?.name ?? null
    if (!paintsOnEmptyCard(config, null, { mode: 'trigger', triggerId, triggerName })) {
      paintsNothing.push(`${blockType} trigger.${triggerId}`)
    }
    failures.push(...validateTriggerSentence(config, triggerId, triggerName))
  }

  const sentenceSet = config.canvasPresentation?.sentences
  if (sentenceSet) {
    const operationSubBlockId = getOperationSubBlockId(config)

    /* The state a user actually lands on first: whatever the dropdown seeds. */
    const seeded = seededOperationValue(config, operationSubBlockId)
    const asDropped: CardSelector = { mode: 'action', operationValue: seeded }
    if (!paintsOnEmptyCard(config, operationSubBlockId, asDropped)) {
      paintsNothing.push(`${blockType} (as dropped, operation=${JSON.stringify(seeded)})`)
    }

    if (
      sentenceSet.default &&
      !paintsOnEmptyCard(config, operationSubBlockId, { mode: 'action', operationValue: undefined })
    ) {
      paintsNothing.push(`${blockType} default`)
    }
    for (const operationId of Object.keys(sentenceSet.byOperation ?? {})) {
      const operationValue = operationSubBlockId ? operationId : undefined
      if (!paintsOnEmptyCard(config, operationSubBlockId, { mode: 'action', operationValue })) {
        paintsNothing.push(`${blockType} byOperation.${operationId}`)
      }
    }
  }

  if (render) {
    const sentences = config.canvasPresentation?.sentences
    const lines: string[] = []
    const renderOperationId = getOperationSubBlockId(config)
    const pushReadings = (label: string, operationValue: unknown) => {
      const { filled, bare } = renderSentenceReadings(config, renderOperationId, {
        mode: 'action',
        operationValue,
      })
      lines.push(`    ${label.padEnd(32)} ${filled}`)
      if (bare !== filled) {
        lines.push(
          `    ${''.padEnd(32)} ↳ unset: ${bare || '(empty — the card would paint nothing)'}`
        )
      }
    }
    if (sentences?.default) pushReadings('(default)', undefined)
    for (const operationId of Object.keys(sentences?.byOperation ?? {})) {
      pushReadings(operationId, renderOperationId ? operationId : undefined)
    }
    if (lines.length > 0) {
      console.log(`\n  ${blockType}`)
      for (const line of lines) console.log(line)
    }
  }

  if (failures.length > 0) {
    failureCount += failures.length
    failureLines.push(`  ${blockType}`)
    for (const failure of failures) {
      failureLines.push(`    ${failure.location}: ${failure.message}`)
    }
    failureLines.push('')
  }

  coveredOperations += coverage.covered
  totalOperations += coverage.total
  if (coverage.missing.length > 0) incomplete.push({ blockType, missing: coverage.missing })
}

if (failureCount > 0) {
  console.error('\n✗ Canvas sentence check FAILED\n')
  console.error(
    'A broken sentence fails silently at runtime — no throw, no log, just a card that ' +
      'stops reading like the rest of the canvas.\n'
  )
  for (const line of failureLines) console.error(line)
} else {
  console.log(`✓ Canvas sentence check passed (${entries.length} block(s))`)
}

if (paintsNothing.length > 0) {
  console.error(
    `\n✗ ${paintsNothing.length} sentence(s) resolve to nothing on an untouched card, ` +
      'so those cards paint empty:\n'
  )
  for (const entry of paintsNothing.slice(0, 20)) console.error(`  ${entry}`)
  if (paintsNothing.length > 20) console.error(`  +${paintsNothing.length - 20} more`)
  console.error('')
}

const percent =
  totalOperations === 0 ? 100 : Math.round((coveredOperations / totalOperations) * 100)
console.log(
  `\nCoverage: ${coveredOperations}/${totalOperations} operations (${percent}%) across ` +
    `${entries.length - incomplete.length}/${entries.length} blocks`
)

if (requireCoverage && incomplete.length > 0) {
  console.error(`\n✗ Coverage check FAILED — ${incomplete.length} block(s) incomplete\n`)
  for (const entry of incomplete) {
    const preview = entry.missing.slice(0, 8).join(', ')
    const more = entry.missing.length > 8 ? `, +${entry.missing.length - 8} more` : ''
    console.error(`  ${entry.blockType}: missing ${preview}${more}`)
  }
  console.error('')
} else if (blockFilter && incomplete.length > 0) {
  console.log(`  missing: ${incomplete[0].missing.join(', ')}`)
}

const passed =
  failureCount === 0 && paintsNothing.length === 0 && (!requireCoverage || incomplete.length === 0)
process.exit(passed ? 0 : 1)

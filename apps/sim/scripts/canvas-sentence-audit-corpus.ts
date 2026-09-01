#!/usr/bin/env bun

/**
 * Emits every canvas sentence as prose, paired with the operation it claims to
 * describe.
 *
 * Structural validation is already covered by `check-canvas-sentences.ts`. What
 * it cannot judge is whether a sentence is *true* — whether "Fetch every span
 * in trace ⟨traceId⟩" is what the operation actually does, whether two
 * operations read identically, whether the copy is grammatical. That needs a
 * reader, and 4,583 sentences are only reviewable if the reader is handed the
 * prose rather than the 500–3600 line block file behind it.
 *
 * So each operation carries exactly what a prose judgement needs: the label, the
 * tool's own description, and BOTH readings the card has (see
 * `renderSentenceReadings` — the unset reading is what an untouched card shows,
 * and it is the one most likely to be wrong).
 *
 * Usage:
 *   bun run apps/sim/scripts/canvas-sentence-audit-corpus.ts > corpus.json
 *   bun run apps/sim/scripts/canvas-sentence-audit-corpus.ts --stats
 */

import { readFileSync } from 'fs'
import { getOperationSubBlockId } from '@/lib/workflows/blocks/canvas-sentence'
import { renderSentenceReadings } from '@/lib/workflows/blocks/canvas-sentence-render'
import { getBlockRegistry } from '@/blocks/registry'

const statsOnly = process.argv.slice(2).includes('--stats')

/** Tool descriptions keyed by operation label, from the generated catalog. */
function loadToolDescriptions(): Map<string, Map<string, string>> {
  const byType = new Map<string, Map<string, string>>()
  try {
    const catalog = JSON.parse(
      readFileSync('packages/deployment-config/src/integrations.json', 'utf-8')
    ) as {
      integrations: Array<{
        type: string
        operations?: Array<{ name: string; description: string }>
      }>
    }
    for (const integration of catalog.integrations) {
      const byLabel = new Map<string, string>()
      for (const operation of integration.operations ?? []) {
        byLabel.set(operation.name, operation.description)
      }
      byType.set(integration.type, byLabel)
    }
  } catch {
    /* `category: 'blocks'` entries have no catalog row. */
  }
  return byType
}

const descriptionsByType = loadToolDescriptions()

interface AuditOperation {
  id: string
  label: string
  does?: string
  filled: string
  bare: string
}

interface AuditBlock {
  type: string
  name: string
  description: string
  operations: AuditOperation[]
}

const blocks: AuditBlock[] = []

for (const [blockType, config] of Object.entries(getBlockRegistry())) {
  const sentences = config.canvasPresentation?.sentences
  if (!sentences) continue

  const operationSubBlockId = getOperationSubBlockId(config)
  const operationSubBlock = operationSubBlockId
    ? config.subBlocks.find((subBlock) => subBlock.id === operationSubBlockId)
    : undefined
  const rawOptions =
    typeof operationSubBlock?.options === 'function'
      ? operationSubBlock.options()
      : operationSubBlock?.options
  const options = Array.isArray(rawOptions) ? rawOptions : []
  const toolDescriptions = descriptionsByType.get(blockType)

  const operations: AuditOperation[] = []

  /* A block with no operation dropdown paints one sentence for every run. */
  if (options.length === 0) {
    if (!sentences.default) continue
    operations.push({
      id: '(default)',
      label: config.name,
      does: config.description,
      ...renderSentenceReadings(config, operationSubBlockId, {
        mode: 'action',
        operationValue: undefined,
      }),
    })
  }

  for (const option of options) {
    const sentence = sentences.byOperation?.[option.id] ?? sentences.default
    if (!sentence) continue
    const does = toolDescriptions?.get(option.label)
    operations.push({
      id: option.id,
      label: option.label,
      ...(does ? { does } : {}),
      ...renderSentenceReadings(config, operationSubBlockId, {
        mode: 'action',
        operationValue: operationSubBlockId ? option.id : undefined,
      }),
    })
  }

  if (operations.length > 0) {
    blocks.push({
      type: blockType,
      name: config.name,
      description: config.description,
      operations,
    })
  }
}

if (statsOnly) {
  const totalOperations = blocks.reduce((sum, block) => sum + block.operations.length, 0)
  const withDoes = blocks.reduce(
    (sum, block) => sum + block.operations.filter((operation) => operation.does).length,
    0
  )
  const sorted = [...blocks].sort((a, b) => b.operations.length - a.operations.length)
  console.log(`blocks: ${blocks.length}`)
  console.log(`operations: ${totalOperations}`)
  console.log(
    `with tool description: ${withDoes} (${Math.round((withDoes / totalOperations) * 100)}%)`
  )
  console.log('\nlargest blocks:')
  for (const block of sorted.slice(0, 12)) {
    console.log(`  ${block.type.padEnd(28)} ${block.operations.length}`)
  }
} else {
  console.log(JSON.stringify(blocks))
}

#!/usr/bin/env bun

/**
 * Emits everything needed to author a block's canvas sentences, and nothing else.
 *
 * A block file runs 500–3600 lines, and the facts a sentence depends on are a
 * small slice of that: which operations exist, what each one does, and which
 * fields each one can actually show. Reading the file to recover that slice is
 * the dominant cost of authoring at fleet scale, and it is the step most likely
 * to go wrong — the operation→field mapping lives in `condition` objects
 * scattered across hundreds of subblocks.
 *
 * So this resolves it once, mechanically:
 *
 * - `operations[]` pairs each dropdown option id with its label and the
 *   description of the tool it selects
 * - every subblock lists the operation ids it is visible for
 * - `canonicalGroups` names every member of each basic/advanced pair, which is
 *   the fact a clause must not get wrong
 *
 * Usage:
 *   bun run apps/sim/scripts/canvas-sentence-spec.ts --block=slack
 *   bun run apps/sim/scripts/canvas-sentence-spec.ts --block=slack --pretty
 */

import { readFileSync } from 'fs'
import { getOperationSubBlockId } from '@/lib/workflows/blocks/canvas-sentence'
import { buildCanonicalIndex, isCanonicalPair } from '@/lib/workflows/subblocks/visibility'
import { getBlockRegistry } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'

const args = process.argv.slice(2)
const blockType = args.find((arg) => arg.startsWith('--block='))?.slice('--block='.length)
const pretty = args.includes('--pretty')

if (!blockType) {
  console.error('Usage: canvas-sentence-spec.ts --block=<type> [--pretty]')
  process.exit(1)
}

const config = getBlockRegistry()[blockType]
if (!config) {
  console.error(`✗ No block registered as "${blockType}".`)
  process.exit(1)
}

/** Tool descriptions keyed by operation label, from the generated catalog. */
function loadToolDescriptions(type: string): Map<string, string> {
  const byLabel = new Map<string, string>()
  try {
    const catalog = JSON.parse(
      readFileSync('packages/deployment-config/src/integrations.json', 'utf-8')
    ) as {
      integrations: Array<{
        type: string
        operations?: Array<{ name: string; description: string }>
      }>
    }
    const entry = catalog.integrations.find((integration) => integration.type === type)
    for (const operation of entry?.operations ?? []) {
      byLabel.set(operation.name, operation.description)
    }
  } catch {
    /* `category: 'blocks'` entries have no catalog row; the caller falls back
       to the tool configs under `apps/sim/tools/`. */
  }
  return byLabel
}

const operationSubBlockId = getOperationSubBlockId(config)
const operationSubBlock = operationSubBlockId
  ? config.subBlocks.find((subBlock) => subBlock.id === operationSubBlockId)
  : undefined

const rawOptions =
  typeof operationSubBlock?.options === 'function'
    ? operationSubBlock.options()
    : operationSubBlock?.options
const options = Array.isArray(rawOptions) ? rawOptions : []
const operationIds = options.map((option) => option.id)

const toolDescriptions = loadToolDescriptions(blockType)

/** Operation ids a single `{field,value,not}` clause admits, or null if it says nothing. */
function operationsAllowedBy(clause: {
  field: string
  value: unknown
  not?: boolean
}): string[] | null {
  if (clause.field !== 'operation') return null
  const listed = new Set((Array.isArray(clause.value) ? clause.value : [clause.value]).map(String))
  return operationIds.filter((id) => (clause.not ? !listed.has(id) : listed.has(id)))
}

/**
 * Which operations a subblock definition can appear for.
 *
 * Both arms of the condition are resolved. A subblock gated on a non-operation
 * field but ANDed with an operation clause — `{ field: 'processingMode', value:
 * 'async', and: { field: 'operation', value: 'analyze_id', not: true } }` — is
 * genuinely hidden for that operation, and reporting it as visible invites a
 * dead clause the validator also cannot catch.
 */
function visibleOperations(subBlock: SubBlockConfig): string[] | 'all' | 'unknown' {
  if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') return []
  if (!subBlock.condition) return 'all'
  if (typeof subBlock.condition === 'function') return 'unknown'

  const main = operationsAllowedBy(subBlock.condition)
  const and = subBlock.condition.and ? operationsAllowedBy(subBlock.condition.and) : null

  if (main === null && and === null) return 'unknown'
  if (main === null) return and as string[]
  if (and === null) return main

  const allowed = new Set(and)
  return main.filter((id) => allowed.has(id))
}

const canonicalIndex = buildCanonicalIndex(config.subBlocks)

/* A sentence can never usefully name these: the operation selector supplies the
   verb, and a credential renders as `•••` or a masked account name. */
const EXCLUDED_TYPES = new Set(['oauth-input', 'credential-selector'])

function isUnusable(subBlock: SubBlockConfig): boolean {
  return EXCLUDED_TYPES.has(subBlock.type) || subBlock.password === true
}

/*
 * Drop a canonical group whole when any member is unusable. Filtering member by
 * member would leave `manualCredential` offered while `credential` is hidden —
 * and a clause naming one member of a pair without the other is exactly the bug
 * the group listing exists to prevent.
 */
const unusableCanonicalIds = new Set(
  config.subBlocks
    .filter((subBlock) => subBlock.canonicalParamId && isUnusable(subBlock))
    .map((subBlock) => subBlock.canonicalParamId as string)
)

const canonicalGroups: Record<string, string[]> = {}
for (const [canonicalId, group] of Object.entries(canonicalIndex.groupsById)) {
  if (!isCanonicalPair(group) || unusableCanonicalIds.has(canonicalId)) continue
  canonicalGroups[canonicalId] = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
}

const subBlocks = config.subBlocks
  .filter((subBlock) => subBlock.id !== operationSubBlockId)
  .filter((subBlock) => !subBlock.hidden && !subBlock.hideFromPreview)
  .filter((subBlock) => !isUnusable(subBlock))
  .filter(
    (subBlock) => !subBlock.canonicalParamId || !unusableCanonicalIds.has(subBlock.canonicalParamId)
  )
  .map((subBlock) => {
    const operations = visibleOperations(subBlock)
    return {
      id: subBlock.id,
      title: subBlock.title,
      type: subBlock.type,
      ...(subBlock.canonicalParamId ? { canonicalParamId: subBlock.canonicalParamId } : {}),
      operations,
    }
  })
  .filter(
    (subBlock) =>
      subBlock.operations === 'all' ||
      subBlock.operations === 'unknown' ||
      subBlock.operations.length > 0
  )

/* One direction only. The per-operation field list is the one an author reads
   ("what can this operation say?"), and carrying the inverse as well doubles
   the payload on a block with 60 operations. */
const spec = {
  type: config.type,
  name: config.name,
  description: config.description,
  category: config.category,
  operationSubBlockId,
  hasCatalogEntry: toolDescriptions.size > 0,
  fieldTitles: Object.fromEntries(
    subBlocks.map((subBlock) => [subBlock.id, subBlock.title ?? subBlock.id])
  ),
  canonicalGroups,
  operations: options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(toolDescriptions.has(option.label) ? { does: toolDescriptions.get(option.label) } : {}),
    /* The only fields this operation can show. A sentence naming anything else
       is a dead clause. */
    fields: subBlocks
      .filter(
        (subBlock) =>
          subBlock.operations === 'all' ||
          subBlock.operations === 'unknown' ||
          subBlock.operations.includes(option.id)
      )
      .map((subBlock) => subBlock.id),
  })),
}

console.log(JSON.stringify(spec, null, pretty ? 2 : 0))

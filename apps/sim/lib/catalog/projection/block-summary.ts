import { normalizeCondition } from '@/lib/catalog/projection/subblock'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { getBlockMeta } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/**
 * Where a block comes from: the code registry, or a workflow this workspace
 * deployed as a block.
 */
export type CatalogBlockSource = 'builtin' | 'custom'

/** Lifecycle state of a shipped block. */
export interface CatalogBlockSunset {
  status: 'legacy' | 'deprecated'
  replacedBy?: string
}

/**
 * List-shaped view of a block: everything needed to decide whether to place it,
 * and nothing that requires resolving its tools.
 *
 * `toolIds` and `operationIds` are identifiers only. Resolving them is a
 * `GET /api/v2/tools/{toolId}` or `GET /api/v2/blocks/{blockId}` call, which is
 * what keeps a 300-block list under a page's worth of bytes.
 */
export interface CatalogBlockSummary {
  id: string
  name: string
  description: string
  longDescription?: string
  category: string
  integrationType?: string
  source: CatalogBlockSource
  authMode?: string
  triggerAllowed: boolean
  /** Whether the block can start a workflow — as a trigger block or in trigger mode. */
  triggerCapable: boolean
  triggerIds: string[]
  toolIds: string[]
  operationIds: string[]
  preview: boolean
  sunset?: CatalogBlockSunset
  docsLink?: string
  tags: string[]
}

/**
 * Whether a block can start a workflow.
 *
 * The three-way predicate is the canonical one: a block in the `triggers`
 * category, a block that declares `triggerAllowed`, or a block carrying a
 * sub-block that only renders in trigger mode. Single-sourced here because the
 * public catalog's `capability=trigger` filter and the Copilot
 * `get_trigger_blocks` tool must agree on it.
 */
export function isTriggerCapableBlock(block: BlockConfig): boolean {
  if (block.category === 'triggers') return true
  if (block.triggerAllowed === true) return true
  return block.subBlocks?.some((subBlock) => subBlock.mode === 'trigger') ?? false
}

/** Sub-blocks that configure the block's action, excluding its trigger-mode fields. */
export function actionSubBlocks(block: BlockConfig): SubBlockConfig[] {
  if (!Array.isArray(block.subBlocks)) return []
  return block.subBlocks.filter(
    (subBlock) => subBlock.mode !== 'trigger' && subBlock.mode !== 'trigger-advanced'
  )
}

/**
 * The operations a block exposes, in the order its operation dropdown declares
 * them.
 *
 * Falls back to the operations named by its sub-blocks' `operation` conditions
 * for blocks that gate fields on an operation without offering a dropdown.
 */
export function resolveOperationIds(block: BlockConfig): string[] {
  const operationField = block.subBlocks?.find((subBlock) => subBlock.id === 'operation')
  if (operationField && Array.isArray(operationField.options)) {
    const ids = operationField.options.map((option) => option.id).filter(Boolean)
    if (ids.length > 0) return ids
  }

  const derived: string[] = []
  for (const subBlock of actionSubBlocks(block)) {
    const condition = normalizeCondition(subBlock.condition)
    if (!condition || condition.field !== 'operation' || condition.not) continue
    if (condition.value === undefined) continue
    for (const value of Array.isArray(condition.value) ? condition.value : [condition.value]) {
      const id = String(value)
      if (!derived.includes(id)) derived.push(id)
    }
  }
  return derived
}

/**
 * Projects one block config down to its catalog summary.
 *
 * Every array published here is a copy. `block.triggers.available`,
 * `block.tools.access`, and a meta's `tags` are the registry's own arrays, live
 * for the whole process, so handing one out would put mutable registry state one
 * careless consumer away from corrupting every later request.
 */
export function projectBlockSummary(block: BlockConfig): CatalogBlockSummary {
  const summary: CatalogBlockSummary = {
    id: block.type,
    name: block.name,
    description: block.description,
    category: block.category,
    source: isCustomBlockType(block.type) ? 'custom' : 'builtin',
    triggerAllowed: block.triggerAllowed === true,
    triggerCapable: isTriggerCapableBlock(block),
    triggerIds: [...(block.triggers?.available ?? [])],
    toolIds: [...(block.tools?.access ?? [])],
    operationIds: resolveOperationIds(block),
    preview: block.preview === true,
    tags: [...(getBlockMeta(block.type)?.tags ?? [])],
  }

  if (block.longDescription !== undefined) summary.longDescription = block.longDescription
  if (block.integrationType !== undefined) summary.integrationType = block.integrationType
  if (block.authMode !== undefined) summary.authMode = block.authMode
  if (block.docsLink !== undefined) summary.docsLink = block.docsLink
  if (block.sunset !== undefined) {
    summary.sunset = { status: block.sunset.status }
    if (block.sunset.replacedBy !== undefined) summary.sunset.replacedBy = block.sunset.replacedBy
  }

  return summary
}

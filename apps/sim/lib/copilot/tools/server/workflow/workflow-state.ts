import crypto from 'crypto'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getAllBlockTypes, getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('WorkflowContextState')

function stableSortValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stableSortValue)
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSortValue(value[key])
    }
    return sorted
  }
  return value
}

export function hashWorkflowState(state: Record<string, unknown>): string {
  const stable = stableSortValue(state)
  const payload = JSON.stringify(stable)
  return `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`
}

function normalizeOptions(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null
  const normalized = options
    .map((option) => {
      if (option == null) return null
      if (typeof option === 'object') {
        const optionRecord = option as Record<string, unknown>
        const id = optionRecord.id
        if (typeof id === 'string') return id
        const label = optionRecord.label
        if (typeof label === 'string') return label
        return null
      }
      return String(option)
    })
    .filter((value): value is string => Boolean(value))
  return normalized.length > 0 ? normalized : null
}

function serializeRequired(required: SubBlockConfig['required']): boolean | Record<string, any> {
  if (typeof required === 'boolean') return required
  if (!required) return false
  if (typeof required === 'object') {
    const out: Record<string, any> = {}
    const record = required as Record<string, unknown>
    for (const key of ['field', 'operator', 'value']) {
      if (record[key] !== undefined) {
        out[key] = record[key]
      }
    }
    return out
  }
  return false
}

function serializeSubBlock(subBlock: SubBlockConfig): Record<string, unknown> {
  const staticOptions =
    typeof subBlock.options === 'function' ? null : normalizeOptions(subBlock.options)
  return {
    id: subBlock.id,
    type: subBlock.type,
    title: subBlock.title,
    description: subBlock.description || null,
    mode: subBlock.mode || null,
    placeholder: subBlock.placeholder || null,
    hidden: Boolean(subBlock.hidden),
    multiSelect: Boolean(subBlock.multiSelect),
    required: serializeRequired(subBlock.required),
    hasDynamicOptions: typeof subBlock.options === 'function',
    options: staticOptions,
    defaultValue: subBlock.defaultValue ?? null,
    min: subBlock.min ?? null,
    max: subBlock.max ?? null,
  }
}

function serializeBlockSchema(blockType: string): Record<string, unknown> | null {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return null

  const subBlocks = Array.isArray(blockConfig.subBlocks)
    ? blockConfig.subBlocks.map(serializeSubBlock)
    : []
  const outputs = blockConfig.outputs || {}
  const outputKeys = Object.keys(outputs)

  return {
    blockType,
    blockName: blockConfig.name || blockType,
    category: blockConfig.category,
    triggerAllowed: Boolean(blockConfig.triggerAllowed || blockConfig.triggers?.enabled),
    hasTriggersConfig: Boolean(blockConfig.triggers?.enabled),
    subBlocks,
    outputKeys,
    longDescription: blockConfig.longDescription || null,
  }
}

export function buildSchemasByType(blockTypes: string[]): {
  schemasByType: Record<string, any>
  schemaRefsByType: Record<string, string>
} {
  const schemasByType: Record<string, any> = {}
  const schemaRefsByType: Record<string, string> = {}

  const uniqueTypes = [...new Set(blockTypes.filter(Boolean))]
  for (const blockType of uniqueTypes) {
    const schema = serializeBlockSchema(blockType)
    if (!schema) continue
    const stableSchema = stableSortValue(schema)
    const schemaHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(stableSchema))
      .digest('hex')
    schemasByType[blockType] = stableSchema
    schemaRefsByType[blockType] = `${blockType}@sha256:${schemaHash}`
  }

  return { schemasByType, schemaRefsByType }
}

export async function loadWorkflowStateFromDb(workflowId: string): Promise<{
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  workspaceId?: string
}> {
  const [workflowRecord] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)
  if (!workflowRecord) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} has no normalized data`)
  }

  const blocks = { ...normalized.blocks }
  const invalidBlockIds: string[] = []
  for (const [blockId, block] of Object.entries(blocks)) {
    if (!(block as { type?: unknown })?.type) {
      invalidBlockIds.push(blockId)
    }
  }

  for (const blockId of invalidBlockIds) {
    delete blocks[blockId]
  }

  const invalidSet = new Set(invalidBlockIds)
  const edges = (normalized.edges || []).filter(
    (edge: any) => !invalidSet.has(edge.source) && !invalidSet.has(edge.target)
  )

  if (invalidBlockIds.length > 0) {
    logger.warn('Dropped blocks without type while loading workflow state', {
      workflowId,
      dropped: invalidBlockIds,
    })
  }

  return {
    workflowState: {
      blocks,
      edges,
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
    },
    workspaceId: workflowRecord.workspaceId || undefined,
  }
}

export function summarizeWorkflowState(workflowState: {
  blocks: Record<string, any>
  edges: Array<Record<string, any>>
  loops: Record<string, any>
  parallels: Record<string, any>
}): Record<string, unknown> {
  const blocks = workflowState.blocks || {}
  const edges = workflowState.edges || []
  const blockTypes: Record<string, number> = {}
  const triggerBlocks: Array<{ id: string; name: string; type: string }> = []

  for (const [blockId, block] of Object.entries(blocks)) {
    const blockType = String((block as Record<string, unknown>).type || 'unknown')
    blockTypes[blockType] = (blockTypes[blockType] || 0) + 1
    if ((block as Record<string, unknown>).triggerMode === true) {
      triggerBlocks.push({
        id: blockId,
        name: String((block as Record<string, unknown>).name || blockType),
        type: blockType,
      })
    }
  }

  return {
    blockCount: Object.keys(blocks).length,
    edgeCount: edges.length,
    loopCount: Object.keys(workflowState.loops || {}).length,
    parallelCount: Object.keys(workflowState.parallels || {}).length,
    blockTypes,
    triggerBlocks,
  }
}

export function getAllKnownBlockTypes(): string[] {
  return getAllBlockTypes()
}

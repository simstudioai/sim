import crypto from 'crypto'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getAllBlockTypes, getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('WorkflowContextState')
const CONTAINER_BLOCK_TYPES = ['loop', 'parallel'] as const

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
  if (blockType === 'loop') {
    return {
      blockType: 'loop',
      blockName: 'Loop',
      category: 'blocks',
      triggerAllowed: false,
      hasTriggersConfig: false,
      subBlocks: [
        {
          id: 'loopType',
          type: 'dropdown',
          title: 'Loop Type',
          description: 'Loop mode: for, forEach, while, doWhile',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: ['for', 'forEach', 'while', 'doWhile'],
          defaultValue: 'for',
          min: null,
          max: null,
        },
        {
          id: 'iterations',
          type: 'short-input',
          title: 'Iterations',
          description: 'Iteration count for for-loops',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: null,
          defaultValue: 1,
          min: 1,
          max: null,
        },
        {
          id: 'collection',
          type: 'long-input',
          title: 'Collection',
          description: 'Collection expression for forEach loops',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: null,
          defaultValue: null,
          min: null,
          max: null,
        },
        {
          id: 'condition',
          type: 'long-input',
          title: 'Condition',
          description: 'Condition expression for while/doWhile loops',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: null,
          defaultValue: null,
          min: null,
          max: null,
        },
      ],
      outputKeys: ['index', 'item', 'items'],
      longDescription: null,
    }
  }

  if (blockType === 'parallel') {
    return {
      blockType: 'parallel',
      blockName: 'Parallel',
      category: 'blocks',
      triggerAllowed: false,
      hasTriggersConfig: false,
      subBlocks: [
        {
          id: 'parallelType',
          type: 'dropdown',
          title: 'Parallel Type',
          description: 'Parallel mode: count or collection',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: ['count', 'collection'],
          defaultValue: 'count',
          min: null,
          max: null,
        },
        {
          id: 'count',
          type: 'short-input',
          title: 'Count',
          description: 'Branch count when parallelType is count',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: null,
          defaultValue: 1,
          min: 1,
          max: null,
        },
        {
          id: 'collection',
          type: 'long-input',
          title: 'Collection',
          description: 'Collection expression when parallelType is collection',
          mode: null,
          placeholder: null,
          hidden: false,
          multiSelect: false,
          required: false,
          hasDynamicOptions: false,
          options: null,
          defaultValue: null,
          min: null,
          max: null,
        },
      ],
      outputKeys: ['index', 'currentItem', 'items'],
      longDescription: null,
    }
  }

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
  const MAX_BLOCK_INVENTORY = 160
  const MAX_EDGE_INVENTORY = 240
  const blocks = workflowState.blocks || {}
  const edges = workflowState.edges || []
  const blockTypes: Record<string, number> = {}
  const triggerBlocks: Array<{ id: string; name: string; type: string }> = []
  const blockInventoryRaw: Array<{
    id: string
    name: string
    type: string
    parentId: string | null
    triggerMode: boolean
    enabled: boolean
  }> = []

  const normalizeReferenceToken = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim()

  const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]
  const startOutputKeys = ['input', 'files', 'conversationId']
  const duplicateNameIndex = new Map<string, { name: string; blockIds: string[] }>()

  for (const [blockId, block] of Object.entries(blocks)) {
    const blockRecord = block as Record<string, unknown>
    const dataRecord = (blockRecord.data as Record<string, unknown> | undefined) || undefined
    const blockType = String(blockRecord.type || 'unknown')
    const blockName = String(blockRecord.name || blockType)
    const parentId = String(dataRecord?.parentId || '').trim() || null
    const normalizedName = normalizeReferenceToken(blockName)

    blockTypes[blockType] = (blockTypes[blockType] || 0) + 1
    if (blockRecord.triggerMode === true) {
      triggerBlocks.push({
        id: blockId,
        name: blockName,
        type: blockType,
      })
    }

    blockInventoryRaw.push({
      id: blockId,
      name: blockName,
      type: blockType,
      parentId,
      triggerMode: blockRecord.triggerMode === true,
      enabled: blockRecord.enabled !== false,
    })

    if (normalizedName) {
      const existing = duplicateNameIndex.get(normalizedName)
      if (existing) {
        existing.blockIds.push(blockId)
      } else {
        duplicateNameIndex.set(normalizedName, { name: blockName, blockIds: [blockId] })
      }
    }
  }

  const blockInventory = [...blockInventoryRaw]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_BLOCK_INVENTORY)
  const blockInventoryTruncated = blockInventoryRaw.length > MAX_BLOCK_INVENTORY

  const blockNameById = new Map(blockInventoryRaw.map((entry) => [entry.id, entry.name]))
  const edgeInventoryRaw = edges.map((edge: any) => {
    const source = String(edge.source || '')
    const target = String(edge.target || '')
    const sourceHandle = String(edge.sourceHandle || '').trim() || null
    const targetHandle = String(edge.targetHandle || '').trim() || null
    return {
      source,
      sourceName: blockNameById.get(source) || source,
      sourceHandle,
      target,
      targetName: blockNameById.get(target) || target,
      targetHandle,
    }
  })
  const edgeInventory = edgeInventoryRaw
    .sort((a, b) => {
      const bySource = a.sourceName.localeCompare(b.sourceName)
      if (bySource !== 0) return bySource
      const byTarget = a.targetName.localeCompare(b.targetName)
      if (byTarget !== 0) return byTarget
      return a.source.localeCompare(b.source)
    })
    .slice(0, MAX_EDGE_INVENTORY)
  const edgeInventoryTruncated = edgeInventoryRaw.length > MAX_EDGE_INVENTORY

  const duplicateBlockNames = [...duplicateNameIndex.values()]
    .filter((entry) => entry.blockIds.length > 1)
    .map((entry) => ({
      name: entry.name,
      count: entry.blockIds.length,
      blockIds: entry.blockIds.sort(),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const subflowChildrenMap = new Map<string, string[]>()
  for (const block of blockInventoryRaw) {
    if (!block.parentId) continue
    const existing = subflowChildrenMap.get(block.parentId) || []
    existing.push(block.id)
    subflowChildrenMap.set(block.parentId, existing)
  }
  const subflowChildren = [...subflowChildrenMap.entries()]
    .map(([subflowId, childBlockIds]) => {
      const subflowBlock = blockInventoryRaw.find((block) => block.id === subflowId)
      return {
        subflowId,
        subflowName: subflowBlock?.name || subflowId,
        subflowType: subflowBlock?.type || 'unknown',
        childBlockIds: childBlockIds.sort(),
      }
    })
    .sort((a, b) => a.subflowName.localeCompare(b.subflowName))

  const referenceGuide = blockInventory.map((entry) => {
    const blockSchema = getBlock(entry.type)
    const schemaOutputKeys = Object.keys(blockSchema?.outputs || {})
    const outputKeys =
      entry.type === 'start'
        ? dedupeStrings([...schemaOutputKeys, ...startOutputKeys])
        : dedupeStrings(schemaOutputKeys)
    const referenceToken =
      normalizeReferenceToken(entry.name) || normalizeReferenceToken(entry.type) || entry.id
    return {
      blockId: entry.id,
      blockName: entry.name,
      blockType: entry.type,
      parentId: entry.parentId,
      referenceToken,
      outputKeys,
      examples: outputKeys.slice(0, 4).map((key) => `<${referenceToken}.${key}>`),
    }
  })

  return {
    blockCount: Object.keys(blocks).length,
    edgeCount: edges.length,
    loopCount: Object.keys(workflowState.loops || {}).length,
    parallelCount: Object.keys(workflowState.parallels || {}).length,
    blockTypes,
    triggerBlocks,
    blockInventory,
    blockInventoryTruncated,
    edgeInventory,
    edgeInventoryTruncated,
    duplicateBlockNames,
    subflowChildren,
    referenceGuide,
  }
}

export function getAllKnownBlockTypes(): string[] {
  return [...new Set([...getAllBlockTypes(), ...CONTAINER_BLOCK_TYPES])]
}

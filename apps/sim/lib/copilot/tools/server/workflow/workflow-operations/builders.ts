import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { buildCanonicalIndex, isCanonicalPair } from '@/lib/workflows/subblocks/visibility'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import type { EditWorkflowOperation, SkippedItem, ValidationError } from './types'
import { logSkippedItem, UUID_REGEX } from './types'
import {
  validateInputsForBlock,
  validateSourceHandleForBlock,
  validateTargetHandle,
} from './validation'

/**
 * Helper to create a block state from operation params
 */
export function createBlockFromParams(
  blockId: string,
  params: any,
  parentId?: string,
  errorsCollector?: ValidationError[],
  permissionConfig?: PermissionGroupConfig | null,
  skippedItems?: SkippedItem[]
): any {
  const blockConfig = getAllBlocks().find((b) => b.type === params.type)

  // Validate inputs against block configuration
  let validatedInputs: Record<string, any> | undefined
  if (params.inputs) {
    const result = validateInputsForBlock(params.type, params.inputs, blockId)
    validatedInputs = result.validInputs
    if (errorsCollector && result.errors.length > 0) {
      errorsCollector.push(...result.errors)
    }
  }

  // Determine outputs based on trigger mode
  const triggerMode = params.triggerMode || false
  const isTriggerCapable = blockConfig ? hasTriggerCapability(blockConfig) : false
  const effectiveTriggerMode = Boolean(triggerMode && isTriggerCapable)
  let outputs: Record<string, any>

  if (params.outputs) {
    outputs = params.outputs
  } else if (blockConfig) {
    const subBlocks: Record<string, any> = {}
    if (validatedInputs) {
      Object.entries(validatedInputs).forEach(([key, value]) => {
        // Skip runtime subblock IDs when computing outputs
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
          return
        }
        subBlocks[key] = { id: key, type: 'short-input', value: value }
      })
    }
    outputs = getEffectiveBlockOutputs(params.type, subBlocks, {
      triggerMode: effectiveTriggerMode,
      preferToolOutputs: !effectiveTriggerMode,
    })
  } else {
    outputs = {}
  }

  const blockState: any = {
    id: blockId,
    type: params.type,
    name: params.name,
    position: { x: 0, y: 0 },
    enabled: params.enabled !== undefined ? params.enabled : true,
    horizontalHandles: true,
    advancedMode: params.advancedMode || false,
    height: 0,
    triggerMode: triggerMode,
    subBlocks: {},
    outputs: outputs,
    data: parentId ? { parentId, extent: 'parent' as const } : {},
    locked: false,
  }

  // Add validated inputs as subBlocks
  if (validatedInputs) {
    Object.entries(validatedInputs).forEach(([key, value]) => {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }

      let sanitizedValue = value

      // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
      if (shouldNormalizeArrayIds(key)) {
        sanitizedValue = normalizeArrayWithIds(value)
      }

      // Special handling for tools - normalize and filter disallowed
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = filterDisallowedTools(
          normalizeTools(value),
          permissionConfig ?? null,
          blockId,
          skippedItems ?? []
        )
      }

      // Special handling for responseFormat - normalize to ensure consistent format
      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      blockState.subBlocks[key] = {
        id: key,
        type: 'short-input',
        value: sanitizedValue,
      }
    })
  }

  // Set up subBlocks from block configuration
  if (blockConfig) {
    blockConfig.subBlocks.forEach((subBlock) => {
      if (!blockState.subBlocks[subBlock.id]) {
        blockState.subBlocks[subBlock.id] = {
          id: subBlock.id,
          type: subBlock.type,
          value: null,
        }
      }
    })

    if (validatedInputs) {
      updateCanonicalModesForInputs(blockState, Object.keys(validatedInputs), blockConfig)
    }
  }

  return blockState
}

export function updateCanonicalModesForInputs(
  block: { data?: { canonicalModes?: Record<string, 'basic' | 'advanced'> } },
  inputKeys: string[],
  blockConfig: BlockConfig
): void {
  if (!blockConfig.subBlocks?.length) return

  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const canonicalModeUpdates: Record<string, 'basic' | 'advanced'> = {}

  for (const inputKey of inputKeys) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[inputKey]
    if (!canonicalId) continue

    const group = canonicalIndex.groupsById[canonicalId]
    if (!group || !isCanonicalPair(group)) continue

    const isAdvanced = group.advancedIds.includes(inputKey)
    const existingMode = canonicalModeUpdates[canonicalId]

    if (!existingMode || isAdvanced) {
      canonicalModeUpdates[canonicalId] = isAdvanced ? 'advanced' : 'basic'
    }
  }

  if (Object.keys(canonicalModeUpdates).length > 0) {
    if (!block.data) block.data = {}
    if (!block.data.canonicalModes) block.data.canonicalModes = {}
    Object.assign(block.data.canonicalModes, canonicalModeUpdates)
  }
}

/**
 * Normalize tools array by adding back fields that were sanitized for training
 */
export function normalizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      // New reference format: minimal fields only
      if (tool.customToolId && !tool.schema && !tool.code) {
        return {
          type: tool.type,
          customToolId: tool.customToolId,
          usageControl: tool.usageControl || 'auto',
          isExpanded: tool.isExpanded ?? true,
        }
      }

      // Legacy inline format: include all fields
      const normalized: any = {
        ...tool,
        params: tool.params || {},
        isExpanded: tool.isExpanded ?? true,
      }

      // Ensure schema has proper structure (for inline format)
      if (normalized.schema?.function) {
        normalized.schema = {
          type: 'function',
          function: {
            name: normalized.schema.function.name || tool.title, // Preserve name or derive from title
            description: normalized.schema.function.description,
            parameters: normalized.schema.function.parameters,
          },
        }
      }

      return normalized
    }

    // For other tool types, just ensure isExpanded exists
    return {
      ...tool,
      isExpanded: tool.isExpanded ?? true,
    }
  })
}

/**
 * Subblock types that store arrays of objects with `id` fields.
 * The LLM may generate arbitrary IDs which need to be converted to proper UUIDs.
 */
const ARRAY_WITH_ID_SUBBLOCK_TYPES = new Set([
  'inputFormat', // input-format: Fields with id, name, type, value, collapsed
  'headers', // table: Rows with id, cells (used for HTTP headers)
  'params', // table: Rows with id, cells (used for query params)
  'variables', // table or variables-input: Rows/assignments with id
  'tagFilters', // knowledge-tag-filters: Filters with id, tagName, etc.
  'documentTags', // document-tag-entry: Tags with id, tagName, etc.
  'metrics', // eval-input: Metrics with id, name, description, range
])

/**
 * Normalizes array subblock values by ensuring each item has a valid UUID.
 * The LLM may generate arbitrary IDs like "input-desc-001" or "row-1" which need
 * to be converted to proper UUIDs for consistency with UI-created items.
 */
export function normalizeArrayWithIds(value: unknown): any[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item: any) => {
    if (!item || typeof item !== 'object') {
      return item
    }

    // Check if id is missing or not a valid UUID
    const hasValidUUID = typeof item.id === 'string' && UUID_REGEX.test(item.id)
    if (!hasValidUUID) {
      return { ...item, id: crypto.randomUUID() }
    }

    return item
  })
}

/**
 * Checks if a subblock key should have its array items normalized with UUIDs.
 */
export function shouldNormalizeArrayIds(key: string): boolean {
  return ARRAY_WITH_ID_SUBBLOCK_TYPES.has(key)
}

/**
 * Normalize responseFormat to ensure consistent storage
 * Handles both string (JSON) and object formats
 * Returns pretty-printed JSON for better UI readability
 */
export function normalizeResponseFormat(value: any): string {
  try {
    let obj = value

    // If it's already a string, parse it first
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return ''
      }
      obj = JSON.parse(trimmed)
    }

    // If it's an object, stringify it with consistent formatting
    if (obj && typeof obj === 'object') {
      // Sort keys recursively for consistent comparison
      const sortKeys = (item: any): any => {
        if (Array.isArray(item)) {
          return item.map(sortKeys)
        }
        if (item !== null && typeof item === 'object') {
          return Object.keys(item)
            .sort()
            .reduce((result: any, key: string) => {
              result[key] = sortKeys(item[key])
              return result
            }, {})
        }
        return item
      }

      // Return pretty-printed with 2-space indentation for UI readability
      // The sanitizer will normalize it to minified format for comparison
      return JSON.stringify(sortKeys(obj), null, 2)
    }

    return String(value)
  } catch {
    // If parsing fails, return the original value as string
    return String(value)
  }
}

/**
 * Creates a validated edge between two blocks.
 * Returns true if edge was created, false if skipped due to validation errors.
 */
export function createValidatedEdge(
  modifiedState: any,
  sourceBlockId: string,
  targetBlockId: string,
  sourceHandle: string,
  targetHandle: string,
  operationType: string,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[]
): boolean {
  if (!modifiedState.blocks[targetBlockId]) {
    logger.warn(`Target block "${targetBlockId}" not found. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
    })
    skippedItems?.push({
      type: 'invalid_edge_target',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - target block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlock = modifiedState.blocks[sourceBlockId]
  if (!sourceBlock) {
    logger.warn(`Source block "${sourceBlockId}" not found. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlockType = sourceBlock.type
  if (!sourceBlockType) {
    logger.warn(`Source block "${sourceBlockId}" has no type. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block has no type`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceValidation = validateSourceHandleForBlock(sourceHandle, sourceBlockType, sourceBlock)
  if (!sourceValidation.valid) {
    logger.warn(`Invalid source handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
      error: sourceValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_source_handle',
      operationType,
      blockId: sourceBlockId,
      reason: sourceValidation.error || `Invalid source handle "${sourceHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const targetValidation = validateTargetHandle(targetHandle)
  if (!targetValidation.valid) {
    logger.warn(`Invalid target handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      targetHandle,
      error: targetValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_target_handle',
      operationType,
      blockId: sourceBlockId,
      reason: targetValidation.error || `Invalid target handle "${targetHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  // Use normalized handle if available (e.g., 'if' -> 'condition-{uuid}')
  const finalSourceHandle = sourceValidation.normalizedHandle || sourceHandle

  const boundaryValidation = validateSubflowBoundaryEdge(
    modifiedState,
    sourceBlockId,
    targetBlockId,
    finalSourceHandle
  )
  if (!boundaryValidation.valid) {
    logger.warn('Invalid subflow boundary edge. Edge skipped.', {
      sourceBlockId,
      targetBlockId,
      sourceHandle: finalSourceHandle,
      reason: boundaryValidation.reason,
    })
    skippedItems?.push({
      type: 'invalid_subflow_boundary_edge',
      operationType,
      blockId: sourceBlockId,
      reason:
        boundaryValidation.reason ||
        `Edge from "${sourceBlockId}" to "${targetBlockId}" crosses an invalid subflow boundary`,
      details: {
        sourceHandle: finalSourceHandle,
        targetHandle,
        targetId: targetBlockId,
      },
    })
    return false
  }

  modifiedState.edges.push({
    id: crypto.randomUUID(),
    source: sourceBlockId,
    sourceHandle: finalSourceHandle,
    target: targetBlockId,
    targetHandle,
    type: 'default',
  })
  return true
}

function getParentId(block: any): string | null {
  const parentId = block?.data?.parentId
  if (typeof parentId !== 'string' || !parentId.trim()) {
    return null
  }
  return parentId
}

function isLoopStartHandle(sourceHandle: string): boolean {
  return sourceHandle === 'loop-start-source'
}

function isParallelStartHandle(sourceHandle: string): boolean {
  return sourceHandle === 'parallel-start-source'
}

function isLoopEndHandle(sourceHandle: string): boolean {
  return sourceHandle === 'loop-end-source'
}

function isParallelEndHandle(sourceHandle: string): boolean {
  return sourceHandle === 'parallel-end-source'
}

/**
 * Validates whether an edge violates subflow boundary rules.
 * Rules:
 * 1. Blocks inside a subflow may only connect to blocks inside the same subflow.
 * 2. loop/parallel start handles must target a direct child in the same container.
 * 3. loop/parallel end handles must target outside the same container.
 */
export function validateSubflowBoundaryEdge(
  modifiedState: any,
  sourceBlockId: string,
  targetBlockId: string,
  sourceHandle: string
): { valid: boolean; reason?: string } {
  const sourceBlock = modifiedState?.blocks?.[sourceBlockId]
  const targetBlock = modifiedState?.blocks?.[targetBlockId]
  if (!sourceBlock || !targetBlock) {
    // Source/target existence is validated earlier.
    return { valid: true }
  }

  const sourceParentId = getParentId(sourceBlock)
  const targetParentId = getParentId(targetBlock)

  if (isLoopStartHandle(sourceHandle)) {
    if (sourceBlock.type !== 'loop') {
      return {
        valid: false,
        reason: `Handle "${sourceHandle}" is only valid for loop blocks`,
      }
    }
    if (targetParentId !== sourceBlockId) {
      return {
        valid: false,
        reason: `Loop start edges must target a block inside loop "${sourceBlockId}"`,
      }
    }
    return { valid: true }
  }

  if (isParallelStartHandle(sourceHandle)) {
    if (sourceBlock.type !== 'parallel') {
      return {
        valid: false,
        reason: `Handle "${sourceHandle}" is only valid for parallel blocks`,
      }
    }
    if (targetParentId !== sourceBlockId) {
      return {
        valid: false,
        reason: `Parallel start edges must target a block inside parallel "${sourceBlockId}"`,
      }
    }
    return { valid: true }
  }

  if (isLoopEndHandle(sourceHandle)) {
    if (sourceBlock.type !== 'loop') {
      return {
        valid: false,
        reason: `Handle "${sourceHandle}" is only valid for loop blocks`,
      }
    }
    if (targetParentId === sourceBlockId) {
      return {
        valid: false,
        reason: `Loop end edges cannot target a block inside loop "${sourceBlockId}"`,
      }
    }
    return { valid: true }
  }

  if (isParallelEndHandle(sourceHandle)) {
    if (sourceBlock.type !== 'parallel') {
      return {
        valid: false,
        reason: `Handle "${sourceHandle}" is only valid for parallel blocks`,
      }
    }
    if (targetParentId === sourceBlockId) {
      return {
        valid: false,
        reason: `Parallel end edges cannot target a block inside parallel "${sourceBlockId}"`,
      }
    }
    return { valid: true }
  }

  if (sourceParentId !== targetParentId) {
    return {
      valid: false,
      reason: `Edge crosses subflow boundary: source parent "${sourceParentId ?? 'root'}", target parent "${targetParentId ?? 'root'}"`,
    }
  }

  return { valid: true }
}

/**
 * Remove existing edges touching the given block that violate subflow boundary rules.
 * This is used after structural moves (insert/extract) to prevent stale cross-boundary edges.
 */
export function pruneInvalidSubflowBoundaryEdgesForBlock(
  modifiedState: any,
  blockId: string,
  operationType: string,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[]
): void {
  if (!modifiedState?.edges || !Array.isArray(modifiedState.edges)) {
    return
  }

  const prunedEdges: any[] = []

  modifiedState.edges = modifiedState.edges.filter((edge: any) => {
    const touchesBlock = edge?.source === blockId || edge?.target === blockId
    if (!touchesBlock) {
      return true
    }

    const sourceHandle = typeof edge?.sourceHandle === 'string' ? edge.sourceHandle : 'source'
    const boundaryValidation = validateSubflowBoundaryEdge(
      modifiedState,
      edge.source,
      edge.target,
      sourceHandle
    )

    if (boundaryValidation.valid) {
      return true
    }

    prunedEdges.push(edge)
    skippedItems?.push({
      type: 'invalid_subflow_boundary_edge',
      operationType,
      blockId,
      reason:
        boundaryValidation.reason ||
        `Removed edge "${edge.id || 'unknown'}" due to invalid subflow boundary`,
      details: {
        edgeId: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      },
    })
    return false
  })

  if (prunedEdges.length > 0) {
    logger.info('Pruned invalid subflow boundary edges after structural move', {
      blockId,
      operationType,
      prunedCount: prunedEdges.length,
      edgeIds: prunedEdges.map((edge) => edge.id).filter(Boolean),
    })
  }
}

/**
 * Adds connections as edges for a block.
 * Supports multiple target formats:
 * - String: "target-block-id"
 * - Object: { block: "target-block-id", handle?: "custom-target-handle" }
 * - Array of strings or objects
 */
export function addConnectionsAsEdges(
  modifiedState: any,
  blockId: string,
  connections: Record<string, any>,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[]
): void {
  Object.entries(connections).forEach(([sourceHandle, targets]) => {
    if (targets === null) return

    const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
      createValidatedEdge(
        modifiedState,
        blockId,
        targetBlock,
        sourceHandle,
        targetHandle || 'target',
        'add_edge',
        logger,
        skippedItems
      )
    }

    if (typeof targets === 'string') {
      addEdgeForTarget(targets)
    } else if (Array.isArray(targets)) {
      targets.forEach((target: any) => {
        if (typeof target === 'string') {
          addEdgeForTarget(target)
        } else if (target?.block) {
          addEdgeForTarget(target.block, target.handle)
        }
      })
    } else if (typeof targets === 'object' && targets?.block) {
      addEdgeForTarget(targets.block, targets.handle)
    }
  })
}

export function applyTriggerConfigToBlockSubblocks(block: any, triggerConfig: Record<string, any>) {
  if (!block?.subBlocks || !triggerConfig || typeof triggerConfig !== 'object') {
    return
  }

  Object.entries(triggerConfig).forEach(([configKey, configValue]) => {
    const existingSubblock = block.subBlocks[configKey]
    if (existingSubblock) {
      const existingValue = existingSubblock.value
      const valuesEqual =
        typeof existingValue === 'object' || typeof configValue === 'object'
          ? JSON.stringify(existingValue) === JSON.stringify(configValue)
          : existingValue === configValue

      if (valuesEqual) {
        return
      }

      block.subBlocks[configKey] = {
        ...existingSubblock,
        value: configValue,
      }
    } else {
      block.subBlocks[configKey] = {
        id: configKey,
        type: 'short-input',
        value: configValue,
      }
    }
  })
}

/**
 * Filters out tools that are not allowed by the permission group config
 * Returns both the allowed tools and any skipped tool items for logging
 */
export function filterDisallowedTools(
  tools: any[],
  permissionConfig: PermissionGroupConfig | null,
  blockId: string,
  skippedItems: SkippedItem[]
): any[] {
  if (!permissionConfig) {
    return tools
  }

  const allowedTools: any[] = []

  for (const tool of tools) {
    if (tool.type === 'custom-tool' && permissionConfig.disableCustomTools) {
      logSkippedItem(skippedItems, {
        type: 'tool_not_allowed',
        operationType: 'add',
        blockId,
        reason: `Custom tool "${tool.title || tool.customToolId || 'unknown'}" is not allowed by permission group - tool not added`,
        details: { toolType: 'custom-tool', toolId: tool.customToolId },
      })
      continue
    }
    if (tool.type === 'mcp' && permissionConfig.disableMcpTools) {
      logSkippedItem(skippedItems, {
        type: 'tool_not_allowed',
        operationType: 'add',
        blockId,
        reason: `MCP tool "${tool.title || 'unknown'}" is not allowed by permission group - tool not added`,
        details: { toolType: 'mcp', serverId: tool.params?.serverId },
      })
      continue
    }
    allowedTools.push(tool)
  }

  return allowedTools
}

/**
 * Normalizes block IDs in operations to ensure they are valid UUIDs.
 * The LLM may generate human-readable IDs like "web_search" or "research_agent"
 * which need to be converted to proper UUIDs for database compatibility.
 *
 * Returns the normalized operations and a mapping from old IDs to new UUIDs.
 */
export function normalizeBlockIdsInOperations(operations: EditWorkflowOperation[]): {
  normalizedOperations: EditWorkflowOperation[]
  idMapping: Map<string, string>
} {
  const logger = createLogger('EditWorkflowServerTool')
  const idMapping = new Map<string, string>()

  // First pass: collect all non-UUID block_ids from add/insert operations
  for (const op of operations) {
    if (op.operation_type === 'add' || op.operation_type === 'insert_into_subflow') {
      if (op.block_id && !UUID_REGEX.test(op.block_id)) {
        const newId = crypto.randomUUID()
        idMapping.set(op.block_id, newId)
        logger.debug('Normalizing block ID', { oldId: op.block_id, newId })
      }
    }
  }

  if (idMapping.size === 0) {
    return { normalizedOperations: operations, idMapping }
  }

  logger.info('Normalizing block IDs in operations', {
    normalizedCount: idMapping.size,
    mappings: Object.fromEntries(idMapping),
  })

  // Helper to replace an ID if it's in the mapping
  const replaceId = (id: string | undefined): string | undefined => {
    if (!id) return id
    return idMapping.get(id) ?? id
  }

  // Second pass: update all references to use new UUIDs
  const normalizedOperations = operations.map((op) => {
    const normalized: EditWorkflowOperation = {
      ...op,
      block_id: replaceId(op.block_id) ?? op.block_id,
    }

    if (op.params) {
      normalized.params = { ...op.params }

      // Update subflowId references (for insert_into_subflow)
      if (normalized.params.subflowId) {
        normalized.params.subflowId = replaceId(normalized.params.subflowId)
      }

      // Update connection references
      if (normalized.params.connections) {
        const normalizedConnections: Record<string, any> = {}
        for (const [handle, targets] of Object.entries(normalized.params.connections)) {
          if (typeof targets === 'string') {
            normalizedConnections[handle] = replaceId(targets)
          } else if (Array.isArray(targets)) {
            normalizedConnections[handle] = targets.map((t) => {
              if (typeof t === 'string') return replaceId(t)
              if (t && typeof t === 'object' && t.block) {
                return { ...t, block: replaceId(t.block) }
              }
              return t
            })
          } else if (targets && typeof targets === 'object' && (targets as any).block) {
            normalizedConnections[handle] = { ...targets, block: replaceId((targets as any).block) }
          } else {
            normalizedConnections[handle] = targets
          }
        }
        normalized.params.connections = normalizedConnections
      }

      // Update nestedNodes block IDs
      if (normalized.params.nestedNodes) {
        const normalizedNestedNodes: Record<string, any> = {}
        for (const [childId, childBlock] of Object.entries(normalized.params.nestedNodes)) {
          const newChildId = replaceId(childId) ?? childId
          normalizedNestedNodes[newChildId] = childBlock
        }
        normalized.params.nestedNodes = normalizedNestedNodes
      }
    }

    return normalized
  })

  return { normalizedOperations, idMapping }
}

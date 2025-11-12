import crypto from 'crypto'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlockOutputs } from '@/lib/workflows/block-outputs'
import { extractAndPersistCustomTools } from '@/lib/workflows/custom-tools-persistence'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { getAllBlocks } from '@/blocks/registry'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/consts'

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

/**
 * Topologically sort insert operations to ensure parents are created before children
 * Returns sorted array where parent inserts always come before child inserts
 */
function topologicalSortInserts(
  inserts: EditWorkflowOperation[],
  adds: EditWorkflowOperation[]
): EditWorkflowOperation[] {
  if (inserts.length === 0) return []

  // Build a map of blockId -> operation for quick lookup
  const insertMap = new Map<string, EditWorkflowOperation>()
  inserts.forEach((op) => insertMap.set(op.block_id, op))

  // Build a set of blocks being added (potential parents)
  const addedBlocks = new Set(adds.map((op) => op.block_id))

  // Build dependency graph: block -> blocks that depend on it
  const dependents = new Map<string, Set<string>>()
  const dependencies = new Map<string, Set<string>>()

  inserts.forEach((op) => {
    const blockId = op.block_id
    const parentId = op.params?.subflowId

    dependencies.set(blockId, new Set())

    if (parentId) {
      // Track dependency if parent is being inserted OR being added
      // This ensures children wait for parents regardless of operation type
      const parentBeingCreated = insertMap.has(parentId) || addedBlocks.has(parentId)

      if (parentBeingCreated) {
        // Only add dependency if parent is also being inserted (not added)
        // Because adds run before inserts, added parents are already created
        if (insertMap.has(parentId)) {
          dependencies.get(blockId)!.add(parentId)
          if (!dependents.has(parentId)) {
            dependents.set(parentId, new Set())
          }
          dependents.get(parentId)!.add(blockId)
        }
      }
    }
  })

  // Topological sort using Kahn's algorithm
  const sorted: EditWorkflowOperation[] = []
  const queue: string[] = []

  // Start with nodes that have no dependencies (or depend only on added blocks)
  inserts.forEach((op) => {
    const deps = dependencies.get(op.block_id)!
    if (deps.size === 0) {
      queue.push(op.block_id)
    }
  })

  while (queue.length > 0) {
    const blockId = queue.shift()!
    const op = insertMap.get(blockId)
    if (op) {
      sorted.push(op)
    }

    // Remove this node from dependencies of others
    const children = dependents.get(blockId)
    if (children) {
      children.forEach((childId) => {
        const childDeps = dependencies.get(childId)!
        childDeps.delete(blockId)
        if (childDeps.size === 0) {
          queue.push(childId)
        }
      })
    }
  }

  // If sorted length doesn't match input, there's a cycle (shouldn't happen with valid operations)
  // Just append remaining operations
  if (sorted.length < inserts.length) {
    inserts.forEach((op) => {
      if (!sorted.includes(op)) {
        sorted.push(op)
      }
    })
  }

  return sorted
}

/**
 * Helper to create a block state from operation params
 */
function createBlockFromParams(blockId: string, params: any, parentId?: string): any {
  const blockConfig = getAllBlocks().find((b) => b.type === params.type)

  // Determine outputs based on trigger mode
  const triggerMode = params.triggerMode || false
  let outputs: Record<string, any>

  if (params.outputs) {
    outputs = params.outputs
  } else if (blockConfig) {
    const subBlocks: Record<string, any> = {}
    if (params.inputs) {
      Object.entries(params.inputs).forEach(([key, value]) => {
        // Skip runtime subblock IDs when computing outputs
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
          return
        }
        subBlocks[key] = { id: key, type: 'short-input', value: value }
      })
    }
    outputs = getBlockOutputs(params.type, subBlocks, triggerMode)
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
  }

  // Add inputs as subBlocks
  if (params.inputs) {
    Object.entries(params.inputs).forEach(([key, value]) => {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }

      let sanitizedValue = value

      // Special handling for inputFormat - ensure it's an array
      if (key === 'inputFormat' && value !== null && value !== undefined) {
        if (!Array.isArray(value)) {
          // Invalid format, default to empty array
          sanitizedValue = []
        }
      }

      // Special handling for tools - normalize to restore sanitized fields
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = normalizeTools(value)
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
  }

  return blockState
}

/**
 * Normalize tools array by adding back fields that were sanitized for training
 */
function normalizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      // Reconstruct sanitized custom tool fields
      const normalized: any = {
        ...tool,
        params: tool.params || {},
        isExpanded: tool.isExpanded ?? true,
      }

      // Ensure schema has proper structure
      if (normalized.schema?.function) {
        normalized.schema = {
          type: 'function',
          function: {
            name: tool.title, // Derive name from title
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
 * Normalize responseFormat to ensure consistent storage
 * Handles both string (JSON) and object formats
 * Returns pretty-printed JSON for better UI readability
 */
function normalizeResponseFormat(value: any): string {
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
  } catch (error) {
    // If parsing fails, return the original value as string
    return String(value)
  }
}

/**
 * Helper to add connections as edges for a block
 */
function addConnectionsAsEdges(
  modifiedState: any,
  blockId: string,
  connections: Record<string, any>
): void {
  Object.entries(connections).forEach(([sourceHandle, targets]) => {
    const targetArray = Array.isArray(targets) ? targets : [targets]
    targetArray.forEach((targetId: string) => {
      modifiedState.edges.push({
        id: crypto.randomUUID(),
        source: blockId,
        sourceHandle,
        target: targetId,
        targetHandle: 'target',
        type: 'default',
      })
    })
  })
}

function applyTriggerConfigToBlockSubblocks(block: any, triggerConfig: Record<string, any>) {
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
 * Apply operations directly to the workflow JSON state
 */
function applyOperationsToWorkflowState(
  workflowState: any,
  operations: EditWorkflowOperation[]
): any {
  // Deep clone the workflow state to avoid mutations
  const modifiedState = JSON.parse(JSON.stringify(workflowState))

  // Log initial state
  const logger = createLogger('EditWorkflowServerTool')
  logger.info('Applying operations to workflow:', {
    totalOperations: operations.length,
    operationTypes: operations.reduce((acc: any, op) => {
      acc[op.operation_type] = (acc[op.operation_type] || 0) + 1
      return acc
    }, {}),
    initialBlockCount: Object.keys(modifiedState.blocks || {}).length,
  })

  // Reorder operations: delete -> extract -> add -> insert -> edit
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const extracts = operations.filter((op) => op.operation_type === 'extract_from_subflow')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const inserts = operations.filter((op) => op.operation_type === 'insert_into_subflow')
  const edits = operations.filter((op) => op.operation_type === 'edit')

  // Sort insert operations to ensure parents are inserted before children
  // This handles cases where a loop/parallel is being added along with its children
  const sortedInserts = topologicalSortInserts(inserts, adds)

  const orderedOperations: EditWorkflowOperation[] = [
    ...deletes,
    ...extracts,
    ...adds,
    ...sortedInserts,
    ...edits,
  ]

  logger.info('Operations after reordering:', {
    order: orderedOperations.map(
      (op) =>
        `${op.operation_type}:${op.block_id}${op.params?.subflowId ? `(parent:${op.params.subflowId})` : ''}`
    ),
  })

  for (const operation of orderedOperations) {
    const { operation_type, block_id, params } = operation

    logger.debug(`Executing operation: ${operation_type} for block ${block_id}`, {
      params: params ? Object.keys(params) : [],
      currentBlockCount: Object.keys(modifiedState.blocks).length,
    })

    switch (operation_type) {
      case 'delete': {
        if (modifiedState.blocks[block_id]) {
          // Find all child blocks to remove
          const blocksToRemove = new Set<string>([block_id])
          const findChildren = (parentId: string) => {
            Object.entries(modifiedState.blocks).forEach(([childId, child]: [string, any]) => {
              if (child.data?.parentId === parentId) {
                blocksToRemove.add(childId)
                findChildren(childId)
              }
            })
          }
          findChildren(block_id)

          // Remove blocks
          blocksToRemove.forEach((id) => delete modifiedState.blocks[id])

          // Remove edges connected to deleted blocks
          modifiedState.edges = modifiedState.edges.filter(
            (edge: any) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
          )
        }
        break
      }

      case 'edit': {
        if (modifiedState.blocks[block_id]) {
          const block = modifiedState.blocks[block_id]

          // Ensure block has essential properties
          if (!block.type) {
            logger.warn(`Block ${block_id} missing type property, skipping edit`, {
              blockKeys: Object.keys(block),
              blockData: JSON.stringify(block),
            })
            break
          }

          // Update inputs (convert to subBlocks format)
          if (params?.inputs) {
            if (!block.subBlocks) block.subBlocks = {}
            Object.entries(params.inputs).forEach(([key, value]) => {
              if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
                return
              }
              let sanitizedValue = value

              // Special handling for inputFormat - ensure it's an array
              if (key === 'inputFormat' && value !== null && value !== undefined) {
                if (!Array.isArray(value)) {
                  // Invalid format, default to empty array
                  sanitizedValue = []
                }
              }

              // Special handling for tools - normalize to restore sanitized fields
              if (key === 'tools' && Array.isArray(value)) {
                sanitizedValue = normalizeTools(value)
              }

              // Special handling for responseFormat - normalize to ensure consistent format
              if (key === 'responseFormat' && value) {
                sanitizedValue = normalizeResponseFormat(value)
              }

              if (!block.subBlocks[key]) {
                block.subBlocks[key] = {
                  id: key,
                  type: 'short-input',
                  value: sanitizedValue,
                }
              } else {
                const existingValue = block.subBlocks[key].value
                const valuesEqual =
                  typeof existingValue === 'object' || typeof sanitizedValue === 'object'
                    ? JSON.stringify(existingValue) === JSON.stringify(sanitizedValue)
                    : existingValue === sanitizedValue

                if (!valuesEqual) {
                  block.subBlocks[key].value = sanitizedValue
                }
              }
            })

            if (
              Object.hasOwn(params.inputs, 'triggerConfig') &&
              block.subBlocks.triggerConfig &&
              typeof block.subBlocks.triggerConfig.value === 'object'
            ) {
              applyTriggerConfigToBlockSubblocks(block, block.subBlocks.triggerConfig.value)
            }

            // Update loop/parallel configuration in block.data
            if (block.type === 'loop') {
              block.data = block.data || {}
              if (params.inputs.loopType !== undefined) block.data.loopType = params.inputs.loopType
              if (params.inputs.iterations !== undefined)
                block.data.count = params.inputs.iterations
              if (params.inputs.collection !== undefined)
                block.data.collection = params.inputs.collection
              if (params.inputs.condition !== undefined)
                block.data.whileCondition = params.inputs.condition
            } else if (block.type === 'parallel') {
              block.data = block.data || {}
              if (params.inputs.parallelType !== undefined)
                block.data.parallelType = params.inputs.parallelType
              if (params.inputs.count !== undefined) block.data.count = params.inputs.count
              if (params.inputs.collection !== undefined)
                block.data.collection = params.inputs.collection
            }
          }

          // Update basic properties
          if (params?.type !== undefined) block.type = params.type
          if (params?.name !== undefined) block.name = params.name

          // Handle trigger mode toggle
          if (typeof params?.triggerMode === 'boolean') {
            block.triggerMode = params.triggerMode

            if (params.triggerMode === true) {
              // Remove all incoming edges when enabling trigger mode
              modifiedState.edges = modifiedState.edges.filter(
                (edge: any) => edge.target !== block_id
              )
            }
          }

          // Handle advanced mode toggle
          if (typeof params?.advancedMode === 'boolean') {
            block.advancedMode = params.advancedMode
          }

          // Handle nested nodes update (for loops/parallels)
          if (params?.nestedNodes) {
            // Remove all existing child blocks
            const existingChildren = Object.keys(modifiedState.blocks).filter(
              (id) => modifiedState.blocks[id].data?.parentId === block_id
            )
            existingChildren.forEach((childId) => delete modifiedState.blocks[childId])

            // Remove edges to/from removed children
            modifiedState.edges = modifiedState.edges.filter(
              (edge: any) =>
                !existingChildren.includes(edge.source) && !existingChildren.includes(edge.target)
            )

            // Add new nested blocks
            Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
              const childBlockState = createBlockFromParams(childId, childBlock, block_id)
              modifiedState.blocks[childId] = childBlockState

              // Add connections for child block
              if (childBlock.connections) {
                addConnectionsAsEdges(modifiedState, childId, childBlock.connections)
              }
            })

            // Update loop/parallel configuration based on type
            if (block.type === 'loop') {
              block.data = block.data || {}
              if (params.inputs?.loopType) block.data.loopType = params.inputs.loopType
              if (params.inputs?.iterations) block.data.count = params.inputs.iterations
              if (params.inputs?.collection) block.data.collection = params.inputs.collection
              if (params.inputs?.condition) block.data.whileCondition = params.inputs.condition
            } else if (block.type === 'parallel') {
              block.data = block.data || {}
              if (params.inputs?.parallelType) block.data.parallelType = params.inputs.parallelType
              if (params.inputs?.count) block.data.count = params.inputs.count
              if (params.inputs?.collection) block.data.collection = params.inputs.collection
            }
          }

          // Handle connections update (convert to edges)
          if (params?.connections) {
            // Remove existing edges from this block
            modifiedState.edges = modifiedState.edges.filter(
              (edge: any) => edge.source !== block_id
            )

            // Add new edges based on connections
            Object.entries(params.connections).forEach(([connectionType, targets]) => {
              if (targets === null) return

              // Map semantic connection names to actual React Flow handle IDs
              // 'success' in YAML/connections maps to 'source' handle in React Flow
              const mapConnectionTypeToHandle = (type: string): string => {
                if (type === 'success') return 'source'
                if (type === 'error') return 'error'
                // Conditions and other types pass through as-is
                return type
              }

              const actualSourceHandle = mapConnectionTypeToHandle(connectionType)

              const addEdge = (targetBlock: string, targetHandle?: string) => {
                modifiedState.edges.push({
                  id: crypto.randomUUID(),
                  source: block_id,
                  sourceHandle: actualSourceHandle,
                  target: targetBlock,
                  targetHandle: targetHandle || 'target',
                  type: 'default',
                })
              }

              if (typeof targets === 'string') {
                addEdge(targets)
              } else if (Array.isArray(targets)) {
                targets.forEach((target: any) => {
                  if (typeof target === 'string') {
                    addEdge(target)
                  } else if (target?.block) {
                    addEdge(target.block, target.handle)
                  }
                })
              } else if (typeof targets === 'object' && (targets as any)?.block) {
                addEdge((targets as any).block, (targets as any).handle)
              }
            })
          }

          // Handle edge removal
          if (params?.removeEdges && Array.isArray(params.removeEdges)) {
            params.removeEdges.forEach(({ targetBlockId, sourceHandle = 'source' }) => {
              modifiedState.edges = modifiedState.edges.filter(
                (edge: any) =>
                  !(
                    edge.source === block_id &&
                    edge.target === targetBlockId &&
                    edge.sourceHandle === sourceHandle
                  )
              )
            })
          }
        }
        break
      }

      case 'add': {
        if (params?.type && params?.name) {
          // Create new block with proper structure
          const newBlock = createBlockFromParams(block_id, params)

          // Set loop/parallel data on parent block BEFORE adding to blocks
          if (params.nestedNodes) {
            if (params.type === 'loop') {
              newBlock.data = {
                ...newBlock.data,
                loopType: params.inputs?.loopType || 'for',
                ...(params.inputs?.collection && { collection: params.inputs.collection }),
                ...(params.inputs?.iterations && { count: params.inputs.iterations }),
              }
            } else if (params.type === 'parallel') {
              newBlock.data = {
                ...newBlock.data,
                parallelType: params.inputs?.parallelType || 'count',
                ...(params.inputs?.collection && { collection: params.inputs.collection }),
                ...(params.inputs?.count && { count: params.inputs.count }),
              }
            }
          }

          // Add parent block FIRST before adding children
          // This ensures children can reference valid parentId
          modifiedState.blocks[block_id] = newBlock

          // Handle nested nodes (for loops/parallels created from scratch)
          if (params.nestedNodes) {
            Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
              const childBlockState = createBlockFromParams(childId, childBlock, block_id)
              modifiedState.blocks[childId] = childBlockState

              if (childBlock.connections) {
                addConnectionsAsEdges(modifiedState, childId, childBlock.connections)
              }
            })
          }

          // Add connections as edges
          if (params.connections) {
            addConnectionsAsEdges(modifiedState, block_id, params.connections)
          }
        }
        break
      }

      case 'insert_into_subflow': {
        const subflowId = params?.subflowId
        if (!subflowId || !params?.type || !params?.name) {
          logger.error('Missing required params for insert_into_subflow', { block_id, params })
          break
        }

        const subflowBlock = modifiedState.blocks[subflowId]
        if (!subflowBlock) {
          logger.error('Subflow block not found - parent must be created first', {
            subflowId,
            block_id,
            existingBlocks: Object.keys(modifiedState.blocks),
            operationType: 'insert_into_subflow',
          })
          // This is a critical error - the operation ordering is wrong
          // Skip this operation but don't break the entire workflow
          break
        }

        if (subflowBlock.type !== 'loop' && subflowBlock.type !== 'parallel') {
          logger.error('Subflow block has invalid type', {
            subflowId,
            type: subflowBlock.type,
            block_id,
          })
          break
        }

        // Get block configuration
        const blockConfig = getAllBlocks().find((block) => block.type === params.type)

        // Check if block already exists (moving into subflow) or is new
        const existingBlock = modifiedState.blocks[block_id]

        if (existingBlock) {
          // Moving existing block into subflow - just update parent
          existingBlock.data = {
            ...existingBlock.data,
            parentId: subflowId,
            extent: 'parent' as const,
          }

          // Update inputs if provided
          if (params.inputs) {
            Object.entries(params.inputs).forEach(([key, value]) => {
              // Skip runtime subblock IDs (webhookId, triggerPath, testUrl, testUrlExpiresAt, scheduleId)
              if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
                return
              }

              let sanitizedValue = value

              if (key === 'inputFormat' && value !== null && value !== undefined) {
                if (!Array.isArray(value)) {
                  sanitizedValue = []
                }
              }

              // Special handling for tools - normalize to restore sanitized fields
              if (key === 'tools' && Array.isArray(value)) {
                sanitizedValue = normalizeTools(value)
              }

              // Special handling for responseFormat - normalize to ensure consistent format
              if (key === 'responseFormat' && value) {
                sanitizedValue = normalizeResponseFormat(value)
              }

              if (!existingBlock.subBlocks[key]) {
                existingBlock.subBlocks[key] = {
                  id: key,
                  type: 'short-input',
                  value: sanitizedValue,
                }
              } else {
                existingBlock.subBlocks[key].value = sanitizedValue
              }
            })
          }
        } else {
          // Create new block as child of subflow
          const newBlock = createBlockFromParams(block_id, params, subflowId)
          modifiedState.blocks[block_id] = newBlock
        }

        // Add/update connections as edges
        if (params.connections) {
          // Remove existing edges from this block
          modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

          // Add new connections
          addConnectionsAsEdges(modifiedState, block_id, params.connections)
        }
        break
      }

      case 'extract_from_subflow': {
        const subflowId = params?.subflowId
        if (!subflowId) {
          logger.warn('Missing subflowId for extract_from_subflow', { block_id })
          break
        }

        const block = modifiedState.blocks[block_id]
        if (!block) {
          logger.warn('Block not found for extraction', { block_id })
          break
        }

        // Verify it's actually a child of this subflow
        if (block.data?.parentId !== subflowId) {
          logger.warn('Block is not a child of specified subflow', {
            block_id,
            actualParent: block.data?.parentId,
            specifiedParent: subflowId,
          })
        }

        // Remove parent relationship
        if (block.data) {
          block.data.parentId = undefined
          block.data.extent = undefined
        }

        // Note: We keep the block and its edges, just remove parent relationship
        // The block becomes a root-level block
        break
      }
    }
  }

  // Regenerate loops and parallels after modifications
  modifiedState.loops = generateLoopBlocks(modifiedState.blocks)
  modifiedState.parallels = generateParallelBlocks(modifiedState.blocks)

  // Validate all blocks have types before returning
  const blocksWithoutType = Object.entries(modifiedState.blocks)
    .filter(([_, block]: [string, any]) => !block.type || block.type === undefined)
    .map(([id, block]: [string, any]) => ({ id, block }))

  if (blocksWithoutType.length > 0) {
    logger.error('Blocks without type after operations:', {
      blocksWithoutType: blocksWithoutType.map(({ id, block }) => ({
        id,
        type: block.type,
        name: block.name,
        keys: Object.keys(block),
      })),
    })

    // Attempt to fix by removing type-less blocks
    blocksWithoutType.forEach(({ id }) => {
      delete modifiedState.blocks[id]
    })

    // Remove edges connected to removed blocks
    const removedIds = new Set(blocksWithoutType.map(({ id }) => id))
    modifiedState.edges = modifiedState.edges.filter(
      (edge: any) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
  }

  return modifiedState
}

async function getCurrentWorkflowStateFromDb(
  workflowId: string
): Promise<{ workflowState: any; subBlockValues: Record<string, Record<string, any>> }> {
  const logger = createLogger('EditWorkflowServerTool')
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)
  if (!workflowRecord) throw new Error(`Workflow ${workflowId} not found in database`)
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) throw new Error('Workflow has no normalized data')

  // Validate and fix blocks without types
  const blocks = { ...normalized.blocks }
  const invalidBlocks: string[] = []

  Object.entries(blocks).forEach(([id, block]: [string, any]) => {
    if (!block.type) {
      logger.warn(`Block ${id} loaded without type from database`, {
        blockKeys: Object.keys(block),
        blockName: block.name,
      })
      invalidBlocks.push(id)
    }
  })

  // Remove invalid blocks
  invalidBlocks.forEach((id) => delete blocks[id])

  // Remove edges connected to invalid blocks
  const edges = normalized.edges.filter(
    (edge: any) => !invalidBlocks.includes(edge.source) && !invalidBlocks.includes(edge.target)
  )

  const workflowState: any = {
    blocks,
    edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  }
  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(normalized.blocks).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subId, sub]) => {
      if ((sub as any).value !== undefined) subBlockValues[blockId][subId] = (sub as any).value
    })
  })
  return { workflowState, subBlockValues }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, any> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams, context?: { userId: string }): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { operations, workflowId, currentUserWorkflow } = params
    if (!operations || operations.length === 0) throw new Error('operations are required')
    if (!workflowId) throw new Error('workflowId is required')

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
    })

    // Get current workflow state
    let workflowState: any
    if (currentUserWorkflow) {
      try {
        workflowState = JSON.parse(currentUserWorkflow)
      } catch (error) {
        logger.error('Failed to parse currentUserWorkflow', error)
        throw new Error('Invalid currentUserWorkflow format')
      }
    } else {
      const fromDb = await getCurrentWorkflowStateFromDb(workflowId)
      workflowState = fromDb.workflowState
    }

    // Apply operations directly to the workflow state
    const modifiedWorkflowState = applyOperationsToWorkflowState(workflowState, operations)

    // Validate the workflow state
    const validation = validateWorkflowState(modifiedWorkflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    if (validation.warnings.length > 0) {
      logger.warn('Edited workflow validation warnings', {
        warnings: validation.warnings,
      })
    }

    // Extract and persist custom tools to database
    if (context?.userId) {
      try {
        // Get workspaceId from the workflow
        const [workflowRecord] = await db
          .select({ workspaceId: workflowTable.workspaceId })
          .from(workflowTable)
          .where(eq(workflowTable.id, workflowId))
          .limit(1)

        if (workflowRecord?.workspaceId) {
          const finalWorkflowState = validation.sanitizedState || modifiedWorkflowState
          const { saved, errors } = await extractAndPersistCustomTools(
            finalWorkflowState,
            workflowRecord.workspaceId,
            context.userId
          )

          if (saved > 0) {
            logger.info(`Persisted ${saved} custom tool(s) to database`, { workflowId })
          }

          if (errors.length > 0) {
            logger.warn('Some custom tools failed to persist', { errors, workflowId })
          }
        } else {
          logger.warn('Workflow has no workspaceId, skipping custom tools persistence', {
            workflowId,
          })
        }
      } catch (error) {
        logger.error('Failed to persist custom tools', { error, workflowId })
      }
    } else {
      logger.warn('No userId in context - skipping custom tools persistence', { workflowId })
    }

    logger.info('edit_workflow successfully applied operations', {
      operationCount: operations.length,
      blocksCount: Object.keys(modifiedWorkflowState.blocks).length,
      edgesCount: modifiedWorkflowState.edges.length,
      validationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
    })

    // Return the modified workflow state for the client to convert to YAML if needed
    return {
      success: true,
      workflowState: validation.sanitizedState || modifiedWorkflowState,
    }
  },
}

import { createLogger } from '@sim/logger'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { isValidKey } from '@/lib/workflows/sanitization/key-validation'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { addConnectionsAsEdges, normalizeBlockIdsInOperations } from './builders'
import {
  handleAddOperation,
  handleDeleteOperation,
  handleEditOperation,
  handleExtractFromSubflowOperation,
  handleInsertIntoSubflowOperation,
} from './operations'
import type {
  ApplyOperationsResult,
  EditWorkflowOperation,
  OperationContext,
  ValidationError,
} from './types'
import { logSkippedItem, type SkippedItem } from './types'

const logger = createLogger('EditWorkflowServerTool')

type OperationHandler = (op: EditWorkflowOperation, ctx: OperationContext) => void

const OPERATION_HANDLERS: Record<EditWorkflowOperation['operation_type'], OperationHandler> = {
  delete: handleDeleteOperation,
  extract_from_subflow: handleExtractFromSubflowOperation,
  add: handleAddOperation,
  insert_into_subflow: handleInsertIntoSubflowOperation,
  edit: handleEditOperation,
}

/**
 * Topologically sort insert operations to ensure parents are created before children
 * Returns sorted array where parent inserts always come before child inserts
 */
export function topologicalSortInserts(
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

function orderOperations(operations: EditWorkflowOperation[]): EditWorkflowOperation[] {
  /**
   * Reorder operations to ensure correct execution sequence:
   * 1. delete - Remove blocks first to free up IDs and clean state
   * 2. extract_from_subflow - Extract blocks from subflows before modifications
   * 3. add - Create new blocks (sorted by connection dependencies)
   * 4. insert_into_subflow - Insert blocks into subflows (sorted by parent dependency)
   * 5. edit - Edit existing blocks last, so connections to newly added blocks work
   */
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const extracts = operations.filter((op) => op.operation_type === 'extract_from_subflow')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const inserts = operations.filter((op) => op.operation_type === 'insert_into_subflow')
  const edits = operations.filter((op) => op.operation_type === 'edit')

  // Sort insert operations to ensure parents are inserted before children
  const sortedInserts = topologicalSortInserts(inserts, adds)

  return [...deletes, ...extracts, ...adds, ...sortedInserts, ...edits]
}

/**
 * Apply operations directly to the workflow JSON state
 */
export function applyOperationsToWorkflowState(
  workflowState: Record<string, unknown>,
  operations: EditWorkflowOperation[],
  permissionConfig: PermissionGroupConfig | null = null
): ApplyOperationsResult {
  // Deep clone the workflow state to avoid mutations
  const modifiedState = JSON.parse(JSON.stringify(workflowState))

  // Collect validation errors across all operations
  const validationErrors: ValidationError[] = []

  // Collect skipped items across all operations
  const skippedItems: SkippedItem[] = []

  // Normalize block IDs to UUIDs before processing
  const { normalizedOperations } = normalizeBlockIdsInOperations(operations)

  // Order operations for deterministic application
  const orderedOperations = orderOperations(normalizedOperations)

  logger.info('Applying operations to workflow:', {
    totalOperations: orderedOperations.length,
    operationTypes: orderedOperations.reduce((acc: Record<string, number>, op) => {
      acc[op.operation_type] = (acc[op.operation_type] || 0) + 1
      return acc
    }, {}),
    initialBlockCount: Object.keys((modifiedState as any).blocks || {}).length,
  })

  const ctx: OperationContext = {
    modifiedState,
    skippedItems,
    validationErrors,
    permissionConfig,
    deferredConnections: [],
  }

  for (const operation of orderedOperations) {
    const { operation_type, block_id } = operation

    // CRITICAL: Validate block_id is a valid string and not "undefined"
    // This prevents undefined keys from being set in the workflow state
    if (!isValidKey(block_id)) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: operation_type,
        blockId: String(block_id || 'invalid'),
        reason: `Invalid block_id "${block_id}" (type: ${typeof block_id}) - operation skipped. Block IDs must be valid non-empty strings.`,
      })
      logger.error('Invalid block_id detected in operation', {
        operation_type,
        block_id,
        block_id_type: typeof block_id,
      })
      continue
    }

    const handler = OPERATION_HANDLERS[operation_type]
    if (!handler) continue

    logger.debug(`Executing operation: ${operation_type} for block ${block_id}`, {
      params: operation.params ? Object.keys(operation.params) : [],
      currentBlockCount: Object.keys((modifiedState as any).blocks || {}).length,
    })

    handler(operation, ctx)
  }

  // Pass 2: Add all deferred connections from add/insert operations
  // Now all blocks exist, so connections can be safely created
  if (ctx.deferredConnections.length > 0) {
    logger.info('Processing deferred connections from add/insert operations', {
      deferredConnectionCount: ctx.deferredConnections.length,
      totalBlocks: Object.keys((modifiedState as any).blocks || {}).length,
    })

    for (const { blockId, connections } of ctx.deferredConnections) {
      // Verify the source block still exists (it might have been deleted by a later operation)
      if (!(modifiedState as any).blocks[blockId]) {
        logger.warn('Source block no longer exists for deferred connection', {
          blockId,
          availableBlocks: Object.keys((modifiedState as any).blocks || {}),
        })
        continue
      }

      addConnectionsAsEdges(modifiedState, blockId, connections, logger, skippedItems)
    }

    logger.info('Finished processing deferred connections', {
      totalEdges: (modifiedState as any).edges?.length,
    })
  }
  // Regenerate loops and parallels after modifications

  ;(modifiedState as any).loops = generateLoopBlocks((modifiedState as any).blocks)
  ;(modifiedState as any).parallels = generateParallelBlocks((modifiedState as any).blocks)

  // Validate all blocks have types before returning
  const blocksWithoutType = Object.entries((modifiedState as any).blocks || {})
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
      delete (modifiedState as any).blocks[id]
    })

    // Remove edges connected to removed blocks
    const removedIds = new Set(blocksWithoutType.map(({ id }) => id))
    ;(modifiedState as any).edges = ((modifiedState as any).edges || []).filter(
      (edge: any) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
  }

  return { state: modifiedState, validationErrors, skippedItems }
}

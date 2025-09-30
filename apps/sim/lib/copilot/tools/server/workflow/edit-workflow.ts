import crypto from 'crypto'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { getAllBlocks } from '@/blocks/registry'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
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
  logger.debug('Initial blocks before operations:', {
    blockCount: Object.keys(modifiedState.blocks || {}).length,
    blockTypes: Object.entries(modifiedState.blocks || {}).map(([id, block]: [string, any]) => ({
      id,
      type: block.type,
      hasType: block.type !== undefined,
    })),
  })

  // Reorder operations: delete -> add -> edit to ensure consistent application semantics
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const edits = operations.filter((op) => op.operation_type === 'edit')
  const orderedOperations: EditWorkflowOperation[] = [...deletes, ...adds, ...edits]

  for (const operation of orderedOperations) {
    const { operation_type, block_id, params } = operation

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
              if (!block.subBlocks[key]) {
                block.subBlocks[key] = {
                  id: key,
                  type: 'short-input',
                  value: value,
                }
              } else {
                block.subBlocks[key].value = value
              }
            })
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
          // Get block configuration
          const blockConfig = getAllBlocks().find((block) => block.type === params.type)

          // Create new block with proper structure
          const newBlock: any = {
            id: block_id,
            type: params.type,
            name: params.name,
            position: { x: 0, y: 0 }, // Default position
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            advancedMode: false,
            height: 0,
            triggerMode: false,
            subBlocks: {},
            outputs: blockConfig ? resolveOutputType(blockConfig.outputs) : {},
            data: {},
          }

          // Add inputs as subBlocks
          if (params.inputs) {
            Object.entries(params.inputs).forEach(([key, value]) => {
              newBlock.subBlocks[key] = {
                id: key,
                type: 'short-input',
                value: value,
              }
            })
          }

          // Set up subBlocks from block configuration
          if (blockConfig) {
            blockConfig.subBlocks.forEach((subBlock) => {
              if (!newBlock.subBlocks[subBlock.id]) {
                newBlock.subBlocks[subBlock.id] = {
                  id: subBlock.id,
                  type: subBlock.type,
                  value: null,
                }
              }
            })
          }

          modifiedState.blocks[block_id] = newBlock

          // Add connections as edges
          if (params.connections) {
            Object.entries(params.connections).forEach(([sourceHandle, targets]) => {
              const addEdge = (targetBlock: string, targetHandle?: string) => {
                modifiedState.edges.push({
                  id: crypto.randomUUID(),
                  source: block_id,
                  sourceHandle: sourceHandle,
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
        }
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
  async execute(params: EditWorkflowParams): Promise<any> {
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

import * as schema from '@sim/db'
import { webhook, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/core/config/env'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { mergeSubBlockValues } from '@/lib/workflows/subblocks'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@/socket/constants'

const logger = createLogger('SocketDatabase')

const connectionString = env.DATABASE_URL
const socketDb = drizzle(
  postgres(connectionString, {
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 20,
    max: 15,
    onnotice: () => {},
  }),
  { schema }
)

const db = socketDb

const DEFAULT_LOOP_ITERATIONS = 5
const DEFAULT_PARALLEL_COUNT = 5

/**
 * Shared function to handle auto-connect edge insertion
 * @param tx - Database transaction
 * @param workflowId - The workflow ID
 * @param autoConnectEdge - The auto-connect edge data
 * @param logger - Logger instance
 */
async function insertAutoConnectEdge(
  tx: any,
  workflowId: string,
  autoConnectEdge: any,
  logger: any
) {
  if (!autoConnectEdge) return

  await tx.insert(workflowEdges).values({
    id: autoConnectEdge.id,
    workflowId,
    sourceBlockId: autoConnectEdge.source,
    targetBlockId: autoConnectEdge.target,
    sourceHandle: autoConnectEdge.sourceHandle || null,
    targetHandle: autoConnectEdge.targetHandle || null,
  })
  logger.debug(
    `Added auto-connect edge ${autoConnectEdge.id}: ${autoConnectEdge.source} -> ${autoConnectEdge.target}`
  )
}

enum SubflowType {
  LOOP = 'loop',
  PARALLEL = 'parallel',
}

function isSubflowBlockType(blockType: string): blockType is SubflowType {
  return Object.values(SubflowType).includes(blockType as SubflowType)
}

export async function updateSubflowNodeList(dbOrTx: any, workflowId: string, parentId: string) {
  try {
    // Get all child blocks of this parent
    const childBlocks = await dbOrTx
      .select({ id: workflowBlocks.id })
      .from(workflowBlocks)
      .where(
        and(
          eq(workflowBlocks.workflowId, workflowId),
          sql`${workflowBlocks.data}->>'parentId' = ${parentId}`
        )
      )

    const childNodeIds = childBlocks.map((block: any) => block.id)

    // Get current subflow config
    const subflowData = await dbOrTx
      .select({ config: workflowSubflows.config })
      .from(workflowSubflows)
      .where(and(eq(workflowSubflows.id, parentId), eq(workflowSubflows.workflowId, workflowId)))
      .limit(1)

    if (subflowData.length > 0) {
      const updatedConfig = {
        ...subflowData[0].config,
        nodes: childNodeIds,
      }

      await dbOrTx
        .update(workflowSubflows)
        .set({
          config: updatedConfig,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowSubflows.id, parentId), eq(workflowSubflows.workflowId, workflowId)))

      logger.debug(`Updated subflow ${parentId} node list: [${childNodeIds.join(', ')}]`)
    }
  } catch (error) {
    logger.error(`Error updating subflow node list for ${parentId}:`, error)
  }
}

export async function getWorkflowState(workflowId: string) {
  try {
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (normalizedData) {
      const finalState = {
        deploymentStatuses: {},
        hasActiveWebhook: false,
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        lastSaved: Date.now(),
        isDeployed: workflowData[0].isDeployed || false,
        deployedAt: workflowData[0].deployedAt,
      }

      return {
        ...workflowData[0],
        state: finalState,
        lastModified: Date.now(),
      }
    }
    return {
      ...workflowData[0],
      lastModified: Date.now(),
    }
  } catch (error) {
    logger.error(`Error fetching workflow state for ${workflowId}:`, error)
    throw error
  }
}

export async function persistWorkflowOperation(workflowId: string, operation: any) {
  const startTime = Date.now()
  try {
    const { operation: op, target, payload, timestamp, userId } = operation

    if (op === BLOCK_OPERATIONS.UPDATE_POSITION && Math.random() < 0.01) {
      logger.debug('Socket DB operation sample:', {
        operation: op,
        target,
        workflowId: `${workflowId.substring(0, 8)}...`,
      })
    }

    await db.transaction(async (tx) => {
      await tx
        .update(workflow)
        .set({ updatedAt: new Date(timestamp) })
        .where(eq(workflow.id, workflowId))

      switch (target) {
        case OPERATION_TARGETS.BLOCK:
          await handleBlockOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.BLOCKS:
          await handleBlocksOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.EDGE:
          await handleEdgeOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.EDGES:
          await handleEdgesOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.SUBFLOW:
          await handleSubflowOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.VARIABLE:
          await handleVariableOperationTx(tx, workflowId, op, payload)
          break
        case OPERATION_TARGETS.WORKFLOW:
          await handleWorkflowOperationTx(tx, workflowId, op, payload)
          break
        default:
          throw new Error(`Unknown operation target: ${target}`)
      }
    })

    const duration = Date.now() - startTime
    if (duration > 100) {
      logger.warn('Slow socket DB operation:', {
        operation: operation.operation,
        target: operation.target,
        duration: `${duration}ms`,
        workflowId: `${workflowId.substring(0, 8)}...`,
      })
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error(
      `❌ Error persisting workflow operation (${operation.operation} on ${operation.target}) after ${duration}ms:`,
      error
    )
    throw error
  }
}

async function handleBlockOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case BLOCK_OPERATIONS.UPDATE_POSITION: {
      if (!payload.id || !payload.position) {
        throw new Error('Missing required fields for update position operation')
      }

      if (payload.commit !== true) {
        return
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          positionX: payload.position.x,
          positionY: payload.position.y,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }
      break
    }

    case BLOCK_OPERATIONS.UPDATE_NAME: {
      if (!payload.id || !payload.name) {
        throw new Error('Missing required fields for update name operation')
      }

      // Check if block is protected (locked or inside locked parent)
      const blockToRename = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      if (blockToRename.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      const block = blockToRename[0]
      const parentId = (block.data as Record<string, unknown> | null)?.parentId as
        | string
        | undefined

      if (block.locked) {
        logger.info(`Skipping rename of locked block ${payload.id}`)
        break
      }

      if (parentId) {
        const parentBlock = await tx
          .select({ locked: workflowBlocks.locked })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, parentId), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (parentBlock.length > 0 && parentBlock[0].locked) {
          logger.info(`Skipping rename of block ${payload.id} - parent ${parentId} is locked`)
          break
        }
      }

      await tx
        .update(workflowBlocks)
        .set({
          name: payload.name,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))

      logger.debug(`Updated block name: ${payload.id} -> "${payload.name}"`)
      break
    }

    case BLOCK_OPERATIONS.TOGGLE_ENABLED: {
      if (!payload.id) {
        throw new Error('Missing block ID for toggle enabled operation')
      }

      // Get current enabled state
      const currentBlock = await tx
        .select({ enabled: workflowBlocks.enabled })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      if (currentBlock.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      const newEnabledState = !currentBlock[0].enabled

      await tx
        .update(workflowBlocks)
        .set({
          enabled: newEnabledState,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))

      logger.debug(`Toggled block enabled: ${payload.id} -> ${newEnabledState}`)
      break
    }

    case BLOCK_OPERATIONS.UPDATE_PARENT: {
      if (!payload.id) {
        throw new Error('Missing block ID for update parent operation')
      }

      // Fetch current parent to update subflow node list when detaching or reparenting
      const [existing] = await tx
        .select({
          id: workflowBlocks.id,
          parentId: sql<string | null>`${workflowBlocks.data}->>'parentId'`,
        })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      const isRemovingFromParent = !payload.parentId

      // Get current data to update
      const [currentBlock] = await tx
        .select({ data: workflowBlocks.data })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      const currentData = currentBlock?.data || {}

      // Update data with parentId and extent
      const { parentId: _removedParentId, extent: _removedExtent, ...restData } = currentData
      const updatedData = isRemovingFromParent
        ? restData
        : {
            ...restData,
            ...(payload.parentId ? { parentId: payload.parentId } : {}),
            ...(payload.extent ? { extent: payload.extent } : {}),
          }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          data: updatedData,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      // If the block now has a parent, update the new parent's subflow node list
      if (payload.parentId) {
        await updateSubflowNodeList(tx, workflowId, payload.parentId)
      }
      // If the block had a previous parent, update that parent's node list as well
      if (existing?.parentId && existing.parentId !== payload.parentId) {
        await updateSubflowNodeList(tx, workflowId, existing.parentId)
      }

      logger.debug(
        `Updated block parent: ${payload.id} -> parent: ${payload.parentId || 'null'}, extent: ${payload.extent || 'null'}${
          isRemovingFromParent ? ' (cleared data JSON)' : ''
        }`
      )
      break
    }

    case BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE: {
      if (!payload.id || payload.advancedMode === undefined) {
        throw new Error('Missing required fields for update advanced mode operation')
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          advancedMode: payload.advancedMode,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(`Updated block advanced mode: ${payload.id} -> ${payload.advancedMode}`)
      break
    }

    case BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE: {
      if (!payload.id || !payload.canonicalId || !payload.canonicalMode) {
        throw new Error('Missing required fields for update canonical mode operation')
      }

      const existingBlock = await tx
        .select({ data: workflowBlocks.data })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      const currentData = (existingBlock?.[0]?.data as Record<string, unknown>) || {}
      const currentCanonicalModes = (currentData.canonicalModes as Record<string, unknown>) || {}
      const canonicalModes = {
        ...currentCanonicalModes,
        [payload.canonicalId]: payload.canonicalMode,
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          data: {
            ...currentData,
            canonicalModes,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(
        `Updated block canonical mode: ${payload.id} -> ${payload.canonicalId}: ${payload.canonicalMode}`
      )
      break
    }

    case BLOCK_OPERATIONS.TOGGLE_HANDLES: {
      if (!payload.id || payload.horizontalHandles === undefined) {
        throw new Error('Missing required fields for toggle handles operation')
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          horizontalHandles: payload.horizontalHandles,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(
        `Updated block handles: ${payload.id} -> ${payload.horizontalHandles ? 'horizontal' : 'vertical'}`
      )
      break
    }

    default:
      logger.warn(`Unknown block operation: ${operation}`)
      throw new Error(`Unsupported block operation: ${operation}`)
  }
}

async function handleBlocksOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS: {
      const { updates } = payload
      if (!Array.isArray(updates) || updates.length === 0) {
        return
      }

      for (const update of updates) {
        const { id, position } = update
        if (!id || !position) continue

        await tx
          .update(workflowBlocks)
          .set({
            positionX: position.x,
            positionY: position.y,
          })
          .where(and(eq(workflowBlocks.id, id), eq(workflowBlocks.workflowId, workflowId)))
      }
      break
    }

    case BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS: {
      const { blocks, edges, loops, parallels, subBlockValues } = payload

      logger.info(`Batch adding blocks to workflow ${workflowId}`, {
        blockCount: blocks?.length || 0,
        edgeCount: edges?.length || 0,
        loopCount: Object.keys(loops || {}).length,
        parallelCount: Object.keys(parallels || {}).length,
      })

      if (blocks && blocks.length > 0) {
        // Fetch existing blocks to check for locked parents
        const existingBlocks = await tx
          .select({ id: workflowBlocks.id, locked: workflowBlocks.locked })
          .from(workflowBlocks)
          .where(eq(workflowBlocks.workflowId, workflowId))

        type ExistingBlockRecord = (typeof existingBlocks)[number]
        const lockedParentIds = new Set(
          existingBlocks
            .filter((b: ExistingBlockRecord) => b.locked)
            .map((b: ExistingBlockRecord) => b.id)
        )

        // Filter out blocks being added to locked parents
        const allowedBlocks = (blocks as Array<Record<string, unknown>>).filter((block) => {
          const parentId = (block.data as Record<string, unknown> | null)?.parentId as
            | string
            | undefined
          if (parentId && lockedParentIds.has(parentId)) {
            logger.info(`Skipping block ${block.id} - parent ${parentId} is locked`)
            return false
          }
          return true
        })

        if (allowedBlocks.length === 0) {
          logger.info('All blocks filtered out due to locked parents, skipping add')
          break
        }

        const blockValues = allowedBlocks.map((block: Record<string, unknown>) => {
          const blockId = block.id as string
          const mergedSubBlocks = mergeSubBlockValues(
            block.subBlocks as Record<string, unknown>,
            subBlockValues?.[blockId]
          )

          return {
            id: blockId,
            workflowId,
            type: block.type as string,
            name: block.name as string,
            positionX: (block.position as { x: number; y: number }).x,
            positionY: (block.position as { x: number; y: number }).y,
            data: (block.data as Record<string, unknown>) || {},
            subBlocks: mergedSubBlocks,
            outputs: (block.outputs as Record<string, unknown>) || {},
            enabled: (block.enabled as boolean) ?? true,
            horizontalHandles: (block.horizontalHandles as boolean) ?? true,
            advancedMode: (block.advancedMode as boolean) ?? false,
            triggerMode: (block.triggerMode as boolean) ?? false,
            height: (block.height as number) || 0,
            locked: (block.locked as boolean) ?? false,
          }
        })

        await tx.insert(workflowBlocks).values(blockValues)

        // Create subflow entries for loop/parallel blocks (skip if already in payload)
        const loopIds = new Set(loops ? Object.keys(loops) : [])
        const parallelIds = new Set(parallels ? Object.keys(parallels) : [])
        for (const block of allowedBlocks) {
          const blockId = block.id as string
          if (block.type === 'loop' && !loopIds.has(blockId)) {
            await tx.insert(workflowSubflows).values({
              id: blockId,
              workflowId,
              type: 'loop',
              config: {
                loopType: 'for',
                iterations: DEFAULT_LOOP_ITERATIONS,
                nodes: [],
              },
            })
          } else if (block.type === 'parallel' && !parallelIds.has(blockId)) {
            await tx.insert(workflowSubflows).values({
              id: blockId,
              workflowId,
              type: 'parallel',
              config: {
                parallelType: 'fixed',
                count: DEFAULT_PARALLEL_COUNT,
                nodes: [],
              },
            })
          }
        }

        // Update parent subflow node lists
        const parentIds = new Set<string>()
        for (const block of allowedBlocks) {
          const parentId = (block.data as Record<string, unknown>)?.parentId as string | undefined
          if (parentId) {
            parentIds.add(parentId)
          }
        }
        for (const parentId of parentIds) {
          await updateSubflowNodeList(tx, workflowId, parentId)
        }
      }

      if (edges && edges.length > 0) {
        const edgeValues = edges.map((edge: Record<string, unknown>) => ({
          id: edge.id as string,
          workflowId,
          sourceBlockId: edge.source as string,
          targetBlockId: edge.target as string,
          sourceHandle: (edge.sourceHandle as string | null) || null,
          targetHandle: (edge.targetHandle as string | null) || null,
        }))

        await tx.insert(workflowEdges).values(edgeValues)
      }

      if (loops && Object.keys(loops).length > 0) {
        const loopValues = Object.entries(loops).map(([id, loop]) => ({
          id,
          workflowId,
          type: 'loop',
          config: loop as Record<string, unknown>,
        }))

        await tx.insert(workflowSubflows).values(loopValues)
      }

      if (parallels && Object.keys(parallels).length > 0) {
        const parallelValues = Object.entries(parallels).map(([id, parallel]) => ({
          id,
          workflowId,
          type: 'parallel',
          config: parallel as Record<string, unknown>,
        }))

        await tx.insert(workflowSubflows).values(parallelValues)
      }

      logger.info(`Successfully batch added blocks to workflow ${workflowId}`)
      break
    }

    case BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS: {
      const { ids } = payload
      if (!Array.isArray(ids) || ids.length === 0) {
        return
      }

      logger.info(`Batch removing ${ids.length} blocks from workflow ${workflowId}`)

      // Fetch all blocks to check lock status and filter out protected blocks
      const allBlocks = await tx
        .select({
          id: workflowBlocks.id,
          type: workflowBlocks.type,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      type BlockRecord = (typeof allBlocks)[number]
      const blocksById: Record<string, BlockRecord> = Object.fromEntries(
        allBlocks.map((b: BlockRecord) => [b.id, b])
      )

      // Helper to check if a block is protected (locked or inside locked parent)
      const isProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      // Filter out protected blocks from deletion request
      const deletableIds = ids.filter((id) => !isProtected(id))
      if (deletableIds.length === 0) {
        logger.info('All requested blocks are protected, skipping deletion')
        return
      }

      if (deletableIds.length < ids.length) {
        logger.info(
          `Filtered out ${ids.length - deletableIds.length} protected blocks from deletion`
        )
      }

      // Collect all block IDs including children of subflows
      const allBlocksToDelete = new Set<string>(deletableIds)

      for (const id of deletableIds) {
        const block = blocksById[id]
        if (block && isSubflowBlockType(block.type)) {
          // Include all children of the subflow (they should be deleted with parent)
          for (const b of allBlocks) {
            const parentId = (b.data as Record<string, unknown> | null)?.parentId
            if (parentId === id) {
              allBlocksToDelete.add(b.id)
            }
          }
        }
      }

      const blockIdsArray = Array.from(allBlocksToDelete)

      // Collect parent IDs BEFORE deleting blocks (use blocksById, already fetched)
      const parentIds = new Set<string>()
      for (const id of deletableIds) {
        const block = blocksById[id]
        const parentId = (block?.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId) {
          parentIds.add(parentId)
        }
      }

      // Clean up external webhooks
      const webhooksToCleanup = await tx
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            userId: workflow.userId,
            workspaceId: workflow.workspaceId,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(and(eq(webhook.workflowId, workflowId), inArray(webhook.blockId, blockIdsArray)))

      if (webhooksToCleanup.length > 0) {
        const requestId = `socket-batch-${workflowId}-${Date.now()}`
        for (const { webhook: wh, workflow: wf } of webhooksToCleanup) {
          try {
            await cleanupExternalWebhook(wh, wf, requestId)
          } catch (error) {
            logger.error(`Failed to cleanup webhook ${wh.id}:`, error)
          }
        }
      }

      // Delete edges connected to any of the blocks
      await tx
        .delete(workflowEdges)
        .where(
          and(
            eq(workflowEdges.workflowId, workflowId),
            or(
              inArray(workflowEdges.sourceBlockId, blockIdsArray),
              inArray(workflowEdges.targetBlockId, blockIdsArray)
            )
          )
        )

      // Delete subflow entries
      await tx
        .delete(workflowSubflows)
        .where(
          and(
            eq(workflowSubflows.workflowId, workflowId),
            inArray(workflowSubflows.id, blockIdsArray)
          )
        )

      // Delete all blocks
      await tx
        .delete(workflowBlocks)
        .where(
          and(eq(workflowBlocks.workflowId, workflowId), inArray(workflowBlocks.id, blockIdsArray))
        )

      // Update parent subflow node lists using pre-collected parent IDs
      for (const parentId of parentIds) {
        await updateSubflowNodeList(tx, workflowId, parentId)
      }

      logger.info(
        `Successfully batch removed ${blockIdsArray.length} blocks from workflow ${workflowId}`
      )
      break
    }

    case BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED: {
      const { blockIds } = payload
      if (!Array.isArray(blockIds) || blockIds.length === 0) {
        return
      }

      logger.info(
        `Batch toggling enabled state for ${blockIds.length} blocks in workflow ${workflowId}`
      )

      // Get all blocks in workflow to find children and check locked state
      const allBlocks = await tx
        .select({
          id: workflowBlocks.id,
          enabled: workflowBlocks.enabled,
          locked: workflowBlocks.locked,
          type: workflowBlocks.type,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      type BlockRecord = (typeof allBlocks)[number]
      const blocksById: Record<string, BlockRecord> = Object.fromEntries(
        allBlocks.map((b: BlockRecord) => [b.id, b])
      )
      const blocksToToggle = new Set<string>()

      // Collect all blocks to toggle including children of containers
      for (const id of blockIds) {
        const block = blocksById[id]
        if (!block || block.locked) continue

        blocksToToggle.add(id)

        // If it's a loop or parallel, also include all children
        if (block.type === 'loop' || block.type === 'parallel') {
          for (const b of allBlocks) {
            const parentId = (b.data as Record<string, unknown> | null)?.parentId
            if (parentId === id && !b.locked) {
              blocksToToggle.add(b.id)
            }
          }
        }
      }

      // Determine target enabled state based on first toggleable block
      if (blocksToToggle.size === 0) break
      const firstToggleableId = Array.from(blocksToToggle)[0]
      const firstBlock = blocksById[firstToggleableId]
      if (!firstBlock) break
      const targetEnabled = !firstBlock.enabled

      // Update all affected blocks
      for (const blockId of blocksToToggle) {
        await tx
          .update(workflowBlocks)
          .set({
            enabled: targetEnabled,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
      }

      logger.debug(`Batch toggled enabled state for ${blocksToToggle.size} blocks`)
      break
    }

    case BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES: {
      const { blockIds } = payload
      if (!Array.isArray(blockIds) || blockIds.length === 0) {
        return
      }

      logger.info(`Batch toggling handles for ${blockIds.length} blocks in workflow ${workflowId}`)

      // Fetch all blocks to check lock status and filter out protected blocks
      const allBlocks = await tx
        .select({
          id: workflowBlocks.id,
          horizontalHandles: workflowBlocks.horizontalHandles,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      type HandleBlockRecord = (typeof allBlocks)[number]
      const blocksById: Record<string, HandleBlockRecord> = Object.fromEntries(
        allBlocks.map((b: HandleBlockRecord) => [b.id, b])
      )

      // Helper to check if a block is protected (locked or inside locked parent)
      const isProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      // Filter to only toggle handles on unprotected blocks
      const blocksToToggle = blockIds.filter((id) => blocksById[id] && !isProtected(id))
      if (blocksToToggle.length === 0) {
        logger.info('All requested blocks are protected, skipping handles toggle')
        break
      }

      for (const blockId of blocksToToggle) {
        const block = blocksById[blockId]
        await tx
          .update(workflowBlocks)
          .set({
            horizontalHandles: !block.horizontalHandles,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
      }

      logger.debug(`Batch toggled handles for ${blocksToToggle.length} blocks`)
      break
    }

    case BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED: {
      const { blockIds } = payload
      if (!Array.isArray(blockIds) || blockIds.length === 0) {
        return
      }

      logger.info(`Batch toggling locked for ${blockIds.length} blocks in workflow ${workflowId}`)

      // Get all blocks in workflow to find children
      const allBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          type: workflowBlocks.type,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      type LockedBlockRecord = (typeof allBlocks)[number]
      const blocksById: Record<string, LockedBlockRecord> = Object.fromEntries(
        allBlocks.map((b: LockedBlockRecord) => [b.id, b])
      )
      const blocksToToggle = new Set<string>()

      // Collect all blocks to toggle including children of containers
      for (const id of blockIds) {
        const block = blocksById[id]
        if (!block) continue

        blocksToToggle.add(id)

        // If it's a loop or parallel, also include all children
        if (block.type === 'loop' || block.type === 'parallel') {
          for (const b of allBlocks) {
            const parentId = (b.data as Record<string, unknown> | null)?.parentId
            if (parentId === id) {
              blocksToToggle.add(b.id)
            }
          }
        }
      }

      // Determine target locked state based on first toggleable block
      if (blocksToToggle.size === 0) break
      const firstToggleableId = Array.from(blocksToToggle)[0]
      const firstBlock = blocksById[firstToggleableId]
      if (!firstBlock) break
      const targetLocked = !firstBlock.locked

      // Update all affected blocks
      for (const blockId of blocksToToggle) {
        await tx
          .update(workflowBlocks)
          .set({
            locked: targetLocked,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
      }

      logger.debug(`Batch toggled locked for ${blocksToToggle.size} blocks`)
      break
    }

    case BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT: {
      const { updates } = payload
      if (!Array.isArray(updates) || updates.length === 0) {
        return
      }

      logger.info(`Batch updating parent for ${updates.length} blocks in workflow ${workflowId}`)

      // Fetch all blocks to check lock status
      const allBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      type ParentBlockRecord = (typeof allBlocks)[number]
      const blocksById: Record<string, ParentBlockRecord> = Object.fromEntries(
        allBlocks.map((b: ParentBlockRecord) => [b.id, b])
      )

      // Helper to check if a block is protected (locked or inside locked parent)
      const isProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const currentParentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (currentParentId && blocksById[currentParentId]?.locked) return true
        return false
      }

      for (const update of updates) {
        const { id, parentId, position } = update
        if (!id) continue

        // Skip protected blocks (locked or inside locked container)
        if (isProtected(id)) {
          logger.info(`Skipping block ${id} parent update - block is protected`)
          continue
        }

        // Skip if trying to move into a locked container
        if (parentId && blocksById[parentId]?.locked) {
          logger.info(`Skipping block ${id} parent update - target parent ${parentId} is locked`)
          continue
        }

        // Fetch current parent to update subflow node lists
        const existing = blocksById[id]
        const existingParentId = (existing?.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined

        if (!existing) {
          logger.warn(`Block ${id} not found for batch-update-parent`)
          continue
        }

        const isRemovingFromParent = !parentId

        // Get current data and position
        const [currentBlock] = await tx
          .select({
            data: workflowBlocks.data,
            positionX: workflowBlocks.positionX,
            positionY: workflowBlocks.positionY,
          })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, id), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        const currentData = currentBlock?.data || {}

        const { parentId: _removedParentId, extent: _removedExtent, ...restData } = currentData
        const updatedData = isRemovingFromParent
          ? restData
          : {
              ...restData,
              ...(parentId ? { parentId, extent: 'parent' } : {}),
            }

        await tx
          .update(workflowBlocks)
          .set({
            positionX: position?.x ?? currentBlock?.positionX ?? 0,
            positionY: position?.y ?? currentBlock?.positionY ?? 0,
            data: updatedData,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, id), eq(workflowBlocks.workflowId, workflowId)))

        // If the block now has a parent, update the new parent's subflow node list
        if (parentId) {
          await updateSubflowNodeList(tx, workflowId, parentId)
        }
        // If the block had a previous parent, update that parent's node list as well
        if (existingParentId && existingParentId !== parentId) {
          await updateSubflowNodeList(tx, workflowId, existingParentId)
        }
      }

      logger.debug(`Batch updated parent for ${updates.length} blocks`)
      break
    }

    default:
      throw new Error(`Unsupported blocks operation: ${operation}`)
  }
}

async function handleEdgeOperationTx(tx: any, workflowId: string, operation: string, payload: any) {
  switch (operation) {
    case EDGE_OPERATIONS.ADD: {
      if (!payload.id || !payload.source || !payload.target) {
        throw new Error('Missing required fields for add edge operation')
      }

      const edgeBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(
          and(
            eq(workflowBlocks.workflowId, workflowId),
            inArray(workflowBlocks.id, [payload.source, payload.target])
          )
        )

      type EdgeBlockRecord = (typeof edgeBlocks)[number]
      const blocksById: Record<string, EdgeBlockRecord> = Object.fromEntries(
        edgeBlocks.map((b: EdgeBlockRecord) => [b.id, b])
      )

      const parentIds = new Set<string>()
      for (const block of edgeBlocks) {
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && !blocksById[parentId]) {
          parentIds.add(parentId)
        }
      }

      // Fetch parent blocks if needed
      if (parentIds.size > 0) {
        const parentBlocks = await tx
          .select({
            id: workflowBlocks.id,
            locked: workflowBlocks.locked,
            data: workflowBlocks.data,
          })
          .from(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              inArray(workflowBlocks.id, Array.from(parentIds))
            )
          )
        for (const b of parentBlocks) {
          blocksById[b.id] = b
        }
      }

      const isBlockProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      if (isBlockProtected(payload.source) || isBlockProtected(payload.target)) {
        logger.info(`Skipping edge add - source or target block is protected`)
        break
      }

      await tx.insert(workflowEdges).values({
        id: payload.id,
        workflowId,
        sourceBlockId: payload.source,
        targetBlockId: payload.target,
        sourceHandle: payload.sourceHandle || null,
        targetHandle: payload.targetHandle || null,
      })

      logger.debug(`Added edge ${payload.id}: ${payload.source} -> ${payload.target}`)
      break
    }

    case EDGE_OPERATIONS.REMOVE: {
      if (!payload.id) {
        throw new Error('Missing edge ID for remove operation')
      }

      // Get the edge to check if connected blocks are protected
      const [edgeToRemove] = await tx
        .select({
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
        })
        .from(workflowEdges)
        .where(and(eq(workflowEdges.id, payload.id), eq(workflowEdges.workflowId, workflowId)))
        .limit(1)

      if (!edgeToRemove) {
        throw new Error(`Edge ${payload.id} not found in workflow ${workflowId}`)
      }

      // Check if source or target blocks are protected
      const connectedBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(
          and(
            eq(workflowBlocks.workflowId, workflowId),
            inArray(workflowBlocks.id, [edgeToRemove.sourceBlockId, edgeToRemove.targetBlockId])
          )
        )

      type RemoveEdgeBlockRecord = (typeof connectedBlocks)[number]
      const blocksById: Record<string, RemoveEdgeBlockRecord> = Object.fromEntries(
        connectedBlocks.map((b: RemoveEdgeBlockRecord) => [b.id, b])
      )

      // Collect parent IDs that need to be fetched
      const parentIds = new Set<string>()
      for (const block of connectedBlocks) {
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && !blocksById[parentId]) {
          parentIds.add(parentId)
        }
      }

      // Fetch parent blocks if needed
      if (parentIds.size > 0) {
        const parentBlocks = await tx
          .select({
            id: workflowBlocks.id,
            locked: workflowBlocks.locked,
            data: workflowBlocks.data,
          })
          .from(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              inArray(workflowBlocks.id, Array.from(parentIds))
            )
          )
        for (const b of parentBlocks) {
          blocksById[b.id] = b
        }
      }

      const isBlockProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      if (
        isBlockProtected(edgeToRemove.sourceBlockId) ||
        isBlockProtected(edgeToRemove.targetBlockId)
      ) {
        logger.info(`Skipping edge remove - source or target block is protected`)
        break
      }

      await tx
        .delete(workflowEdges)
        .where(and(eq(workflowEdges.id, payload.id), eq(workflowEdges.workflowId, workflowId)))

      logger.debug(`Removed edge ${payload.id} from workflow ${workflowId}`)
      break
    }

    default:
      logger.warn(`Unknown edge operation: ${operation}`)
      throw new Error(`Unsupported edge operation: ${operation}`)
  }
}

async function handleEdgesOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case EDGES_OPERATIONS.BATCH_REMOVE_EDGES: {
      const { ids } = payload
      if (!Array.isArray(ids) || ids.length === 0) {
        logger.debug('No edge IDs provided for batch remove')
        return
      }

      logger.info(`Batch removing ${ids.length} edges from workflow ${workflowId}`)

      // Get edges to check connected blocks
      const edgesToRemove = await tx
        .select({
          id: workflowEdges.id,
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
        })
        .from(workflowEdges)
        .where(and(eq(workflowEdges.workflowId, workflowId), inArray(workflowEdges.id, ids)))

      if (edgesToRemove.length === 0) {
        logger.debug('No edges found to remove')
        return
      }

      type EdgeToRemove = (typeof edgesToRemove)[number]

      // Get all connected block IDs
      const connectedBlockIds = new Set<string>()
      edgesToRemove.forEach((e: EdgeToRemove) => {
        connectedBlockIds.add(e.sourceBlockId)
        connectedBlockIds.add(e.targetBlockId)
      })

      // Fetch blocks to check lock status
      const connectedBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(
          and(
            eq(workflowBlocks.workflowId, workflowId),
            inArray(workflowBlocks.id, Array.from(connectedBlockIds))
          )
        )

      type EdgeBlockRecord = (typeof connectedBlocks)[number]
      const blocksById: Record<string, EdgeBlockRecord> = Object.fromEntries(
        connectedBlocks.map((b: EdgeBlockRecord) => [b.id, b])
      )

      // Collect parent IDs that need to be fetched
      const parentIds = new Set<string>()
      for (const block of connectedBlocks) {
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && !blocksById[parentId]) {
          parentIds.add(parentId)
        }
      }

      // Fetch parent blocks if needed
      if (parentIds.size > 0) {
        const parentBlocks = await tx
          .select({
            id: workflowBlocks.id,
            locked: workflowBlocks.locked,
            data: workflowBlocks.data,
          })
          .from(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              inArray(workflowBlocks.id, Array.from(parentIds))
            )
          )
        for (const b of parentBlocks) {
          blocksById[b.id] = b
        }
      }

      const isBlockProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      const safeEdgeIds = edgesToRemove
        .filter(
          (e: EdgeToRemove) =>
            !isBlockProtected(e.sourceBlockId) && !isBlockProtected(e.targetBlockId)
        )
        .map((e: EdgeToRemove) => e.id)

      if (safeEdgeIds.length === 0) {
        logger.info('All edges are connected to protected blocks, skipping removal')
        return
      }

      await tx
        .delete(workflowEdges)
        .where(
          and(eq(workflowEdges.workflowId, workflowId), inArray(workflowEdges.id, safeEdgeIds))
        )

      logger.debug(`Batch removed ${safeEdgeIds.length} edges from workflow ${workflowId}`)
      break
    }

    case EDGES_OPERATIONS.BATCH_ADD_EDGES: {
      const { edges } = payload
      if (!Array.isArray(edges) || edges.length === 0) {
        logger.debug('No edges provided for batch add')
        return
      }

      logger.info(`Batch adding ${edges.length} edges to workflow ${workflowId}`)

      // Get all connected block IDs to check lock status
      const connectedBlockIds = new Set<string>()
      edges.forEach((e: Record<string, unknown>) => {
        connectedBlockIds.add(e.source as string)
        connectedBlockIds.add(e.target as string)
      })

      // Fetch blocks to check lock status
      const connectedBlocks = await tx
        .select({
          id: workflowBlocks.id,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(
          and(
            eq(workflowBlocks.workflowId, workflowId),
            inArray(workflowBlocks.id, Array.from(connectedBlockIds))
          )
        )

      type AddEdgeBlockRecord = (typeof connectedBlocks)[number]
      const blocksById: Record<string, AddEdgeBlockRecord> = Object.fromEntries(
        connectedBlocks.map((b: AddEdgeBlockRecord) => [b.id, b])
      )

      // Collect parent IDs that need to be fetched
      const parentIds = new Set<string>()
      for (const block of connectedBlocks) {
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && !blocksById[parentId]) {
          parentIds.add(parentId)
        }
      }

      // Fetch parent blocks if needed
      if (parentIds.size > 0) {
        const parentBlocks = await tx
          .select({
            id: workflowBlocks.id,
            locked: workflowBlocks.locked,
            data: workflowBlocks.data,
          })
          .from(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              inArray(workflowBlocks.id, Array.from(parentIds))
            )
          )
        for (const b of parentBlocks) {
          blocksById[b.id] = b
        }
      }

      const isBlockProtected = (blockId: string): boolean => {
        const block = blocksById[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = (block.data as Record<string, unknown> | null)?.parentId as
          | string
          | undefined
        if (parentId && blocksById[parentId]?.locked) return true
        return false
      }

      // Filter edges - only add edges where neither block is protected
      const safeEdges = (edges as Array<Record<string, unknown>>).filter(
        (e) => !isBlockProtected(e.source as string) && !isBlockProtected(e.target as string)
      )

      if (safeEdges.length === 0) {
        logger.info('All edges connect to protected blocks, skipping add')
        return
      }

      const edgeValues = safeEdges.map((edge: Record<string, unknown>) => ({
        id: edge.id as string,
        workflowId,
        sourceBlockId: edge.source as string,
        targetBlockId: edge.target as string,
        sourceHandle: (edge.sourceHandle as string | null) || null,
        targetHandle: (edge.targetHandle as string | null) || null,
      }))

      await tx.insert(workflowEdges).values(edgeValues)

      logger.debug(`Batch added ${safeEdges.length} edges to workflow ${workflowId}`)
      break
    }

    default:
      logger.warn(`Unknown edges operation: ${operation}`)
      throw new Error(`Unsupported edges operation: ${operation}`)
  }
}

async function handleSubflowOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case SUBFLOW_OPERATIONS.UPDATE: {
      if (!payload.id || !payload.config) {
        throw new Error('Missing required fields for update subflow operation')
      }

      logger.debug(`Updating subflow ${payload.id} with config:`, payload.config)

      // Update the subflow configuration
      const updateResult = await tx
        .update(workflowSubflows)
        .set({
          config: payload.config,
          updatedAt: new Date(),
        })
        .where(
          and(eq(workflowSubflows.id, payload.id), eq(workflowSubflows.workflowId, workflowId))
        )
        .returning({ id: workflowSubflows.id })

      if (updateResult.length === 0) {
        throw new Error(`Subflow ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(`Successfully updated subflow ${payload.id} in database`)

      // Also update the corresponding block's data to keep UI in sync
      if (payload.type === 'loop') {
        const existingBlock = await tx
          .select({ data: workflowBlocks.data })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        const existingData = (existingBlock[0]?.data as any) || {}

        const blockData: any = {
          ...existingData,
          count: payload.config.iterations ?? existingData.count ?? DEFAULT_LOOP_ITERATIONS,
          loopType: payload.config.loopType ?? existingData.loopType ?? 'for',
          type: 'subflowNode',
          width: existingData.width ?? 500,
          height: existingData.height ?? 300,
          collection:
            payload.config.forEachItems !== undefined
              ? payload.config.forEachItems
              : (existingData.collection ?? ''),
          whileCondition:
            payload.config.whileCondition !== undefined
              ? payload.config.whileCondition
              : (existingData.whileCondition ?? ''),
          doWhileCondition:
            payload.config.doWhileCondition !== undefined
              ? payload.config.doWhileCondition
              : (existingData.doWhileCondition ?? ''),
        }

        await tx
          .update(workflowBlocks)
          .set({
            data: blockData,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
      } else if (payload.type === 'parallel') {
        // Update the parallel block's data properties
        const blockData = {
          ...payload.config,
          width: 500,
          height: 300,
          type: 'subflowNode',
        }

        // Include count if provided
        if (payload.config.count !== undefined) {
          blockData.count = payload.config.count
        }

        // Include collection if provided
        if (payload.config.distribution !== undefined) {
          blockData.collection = payload.config.distribution
        }

        // Include parallelType if provided
        if (payload.config.parallelType !== undefined) {
          blockData.parallelType = payload.config.parallelType
        }

        await tx
          .update(workflowBlocks)
          .set({
            data: blockData,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
      }

      break
    }

    // Add other subflow operations as needed
    default:
      logger.warn(`Unknown subflow operation: ${operation}`)
      throw new Error(`Unsupported subflow operation: ${operation}`)
  }
}

// Variable operations - updates workflow.variables JSON field
async function handleVariableOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  // Get current workflow variables
  const workflowData = await tx
    .select({ variables: workflow.variables })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (workflowData.length === 0) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  const currentVariables = (workflowData[0].variables as Record<string, any>) || {}

  switch (operation) {
    case VARIABLE_OPERATIONS.ADD: {
      if (!payload.id || !payload.name || payload.type === undefined) {
        throw new Error('Missing required fields for add variable operation')
      }

      // Add the new variable
      const updatedVariables = {
        ...currentVariables,
        [payload.id]: {
          id: payload.id,
          workflowId: payload.workflowId,
          name: payload.name,
          type: payload.type,
          value: payload.value || '',
        },
      }

      await tx
        .update(workflow)
        .set({
          variables: updatedVariables,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, workflowId))

      logger.debug(`Added variable ${payload.id} (${payload.name}) to workflow ${workflowId}`)
      break
    }

    case VARIABLE_OPERATIONS.REMOVE: {
      if (!payload.variableId) {
        throw new Error('Missing variable ID for remove operation')
      }

      // Remove the variable
      const { [payload.variableId]: _, ...updatedVariables } = currentVariables

      await tx
        .update(workflow)
        .set({
          variables: updatedVariables,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, workflowId))

      logger.debug(`Removed variable ${payload.variableId} from workflow ${workflowId}`)
      break
    }

    default:
      logger.warn(`Unknown variable operation: ${operation}`)
      throw new Error(`Unsupported variable operation: ${operation}`)
  }
}

// Workflow operations - handles complete state replacement
async function handleWorkflowOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case WORKFLOW_OPERATIONS.REPLACE_STATE: {
      if (!payload.state) {
        throw new Error('Missing state for replace-state operation')
      }

      const { blocks, edges, loops, parallels } = payload.state

      logger.info(`Replacing workflow state for ${workflowId}`, {
        blockCount: Object.keys(blocks || {}).length,
        edgeCount: (edges || []).length,
        loopCount: Object.keys(loops || {}).length,
        parallelCount: Object.keys(parallels || {}).length,
      })

      await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))

      // Delete all existing subflows
      await tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId))

      // Insert all blocks from the new state
      if (blocks && Object.keys(blocks).length > 0) {
        const blockValues = Object.values(blocks).map((block: any) => ({
          id: block.id,
          workflowId,
          type: block.type,
          name: block.name,
          positionX: block.position.x,
          positionY: block.position.y,
          data: block.data || {},
          subBlocks: block.subBlocks || {},
          outputs: block.outputs || {},
          enabled: block.enabled ?? true,
          horizontalHandles: block.horizontalHandles ?? true,
          advancedMode: block.advancedMode ?? false,
          triggerMode: block.triggerMode ?? false,
          height: block.height || 0,
          locked: block.locked ?? false,
        }))

        await tx.insert(workflowBlocks).values(blockValues)
      }

      // Insert all edges from the new state
      if (edges && edges.length > 0) {
        const edgeValues = edges.map((edge: any) => ({
          id: edge.id,
          workflowId,
          sourceBlockId: edge.source,
          targetBlockId: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
        }))

        await tx.insert(workflowEdges).values(edgeValues)
      }

      // Insert all loops from the new state
      if (loops && Object.keys(loops).length > 0) {
        const loopValues = Object.entries(loops).map(([id, loop]: [string, any]) => ({
          id,
          workflowId,
          type: 'loop',
          config: loop,
        }))

        await tx.insert(workflowSubflows).values(loopValues)
      }

      // Insert all parallels from the new state
      if (parallels && Object.keys(parallels).length > 0) {
        const parallelValues = Object.entries(parallels).map(([id, parallel]: [string, any]) => ({
          id,
          workflowId,
          type: 'parallel',
          config: parallel,
        }))

        await tx.insert(workflowSubflows).values(parallelValues)
      }

      logger.info(`Successfully replaced workflow state for ${workflowId}`)
      break
    }

    default:
      logger.warn(`Unknown workflow operation: ${operation}`)
      throw new Error(`Unsupported workflow operation: ${operation}`)
  }
}

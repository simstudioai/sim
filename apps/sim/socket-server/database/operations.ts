import * as schema from '@sim/db'
import { webhook, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cleanupExternalWebhook } from '@/lib/webhooks/webhook-helpers'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'

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

    if (op === 'update-position' && Math.random() < 0.01) {
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
        case 'block':
          await handleBlockOperationTx(tx, workflowId, op, payload)
          break
        case 'edge':
          await handleEdgeOperationTx(tx, workflowId, op, payload)
          break
        case 'subflow':
          await handleSubflowOperationTx(tx, workflowId, op, payload)
          break
        case 'variable':
          await handleVariableOperationTx(tx, workflowId, op, payload)
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
    case 'add': {
      // Validate required fields for add operation
      if (!payload.id || !payload.type || !payload.name || !payload.position) {
        throw new Error('Missing required fields for add block operation')
      }

      logger.debug(`Adding block: ${payload.type} (${payload.id})`, {
        isSubflowType: isSubflowBlockType(payload.type),
      })

      // Extract parentId and extent from payload.data if they exist there, otherwise from payload directly
      const parentId = payload.parentId || payload.data?.parentId || null
      const extent = payload.extent || payload.data?.extent || null

      logger.debug(`Block parent info:`, {
        blockId: payload.id,
        hasParent: !!parentId,
        parentId,
        extent,
        payloadParentId: payload.parentId,
        dataParentId: payload.data?.parentId,
      })

      try {
        const insertData = {
          id: payload.id,
          workflowId,
          type: payload.type,
          name: payload.name,
          positionX: payload.position.x,
          positionY: payload.position.y,
          data: {
            ...(payload.data || {}),
            ...(parentId ? { parentId } : {}),
            ...(extent ? { extent } : {}),
          },
          subBlocks: payload.subBlocks || {},
          outputs: payload.outputs || {},
          enabled: payload.enabled ?? true,
          horizontalHandles: payload.horizontalHandles ?? true,
          advancedMode: payload.advancedMode ?? false,
          triggerMode: payload.triggerMode ?? false,
          height: payload.height || 0,
        }

        await tx.insert(workflowBlocks).values(insertData)

        await insertAutoConnectEdge(tx, workflowId, payload.autoConnectEdge, logger)
      } catch (insertError) {
        logger.error(`❌ Failed to insert block ${payload.id}:`, insertError)
        throw insertError
      }

      // Auto-create subflow entry for loop/parallel blocks
      if (isSubflowBlockType(payload.type)) {
        try {
          const subflowConfig =
            payload.type === SubflowType.LOOP
              ? {
                  id: payload.id,
                  nodes: [], // Empty initially, will be populated when child blocks are added
                  iterations: payload.data?.count || DEFAULT_LOOP_ITERATIONS,
                  loopType: payload.data?.loopType || 'for',
                  // Set the appropriate field based on loop type
                  ...(payload.data?.loopType === 'while'
                    ? { whileCondition: payload.data?.whileCondition || '' }
                    : payload.data?.loopType === 'doWhile'
                      ? { doWhileCondition: payload.data?.doWhileCondition || '' }
                      : { forEachItems: payload.data?.collection || '' }),
                }
              : {
                  id: payload.id,
                  nodes: [], // Empty initially, will be populated when child blocks are added
                  distribution: payload.data?.collection || '',
                  count: payload.data?.count || DEFAULT_PARALLEL_COUNT,
                  parallelType: payload.data?.parallelType || 'count',
                }

          logger.debug(`Auto-creating ${payload.type} subflow ${payload.id}:`, subflowConfig)

          await tx.insert(workflowSubflows).values({
            id: payload.id,
            workflowId,
            type: payload.type,
            config: subflowConfig,
          })
        } catch (subflowError) {
          logger.error(`❌ Failed to create ${payload.type} subflow ${payload.id}:`, subflowError)
          throw subflowError
        }
      }

      // If this block has a parent, update the parent's subflow node list
      if (parentId) {
        await updateSubflowNodeList(tx, workflowId, parentId)
      }

      logger.debug(`Added block ${payload.id} (${payload.type}) to workflow ${workflowId}`)
      break
    }

    case 'update-position': {
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

    case 'remove': {
      if (!payload.id) {
        throw new Error('Missing block ID for remove operation')
      }

      // Collect all block IDs that will be deleted (including child blocks)
      const blocksToDelete = new Set<string>([payload.id])

      // Check if this is a subflow block that needs cascade deletion
      const blockToRemove = await tx
        .select({
          type: workflowBlocks.type,
          parentId: sql<string | null>`${workflowBlocks.data}->>'parentId'`,
        })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      if (blockToRemove.length > 0 && isSubflowBlockType(blockToRemove[0].type)) {
        // Cascade delete: Remove all child blocks first
        const childBlocks = await tx
          .select({ id: workflowBlocks.id, type: workflowBlocks.type })
          .from(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              sql`${workflowBlocks.data}->>'parentId' = ${payload.id}`
            )
          )

        logger.debug(
          `Starting cascade deletion for subflow block ${payload.id} (type: ${blockToRemove[0].type})`
        )
        logger.debug(
          `Found ${childBlocks.length} child blocks to delete: [${childBlocks.map((b: any) => `${b.id} (${b.type})`).join(', ')}]`
        )

        // Add child blocks to deletion set
        childBlocks.forEach((child: { id: string; type: string }) => blocksToDelete.add(child.id))

        // Remove edges connected to child blocks
        for (const childBlock of childBlocks) {
          await tx
            .delete(workflowEdges)
            .where(
              and(
                eq(workflowEdges.workflowId, workflowId),
                or(
                  eq(workflowEdges.sourceBlockId, childBlock.id),
                  eq(workflowEdges.targetBlockId, childBlock.id)
                )
              )
            )
        }

        // Remove child blocks from database
        await tx
          .delete(workflowBlocks)
          .where(
            and(
              eq(workflowBlocks.workflowId, workflowId),
              sql`${workflowBlocks.data}->>'parentId' = ${payload.id}`
            )
          )

        // Remove the subflow entry
        await tx
          .delete(workflowSubflows)
          .where(
            and(eq(workflowSubflows.id, payload.id), eq(workflowSubflows.workflowId, workflowId))
          )
      }

      // Clean up external webhooks before deleting blocks
      try {
        const blockIdsArray = Array.from(blocksToDelete)
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
          logger.debug(
            `Found ${webhooksToCleanup.length} webhook(s) to cleanup for blocks: ${blockIdsArray.join(', ')}`
          )

          const requestId = `socket-${workflowId}-${Date.now()}-${Math.random().toString(36).substring(7)}`

          // Clean up each webhook (don't fail if cleanup fails)
          for (const webhookData of webhooksToCleanup) {
            try {
              await cleanupExternalWebhook(webhookData.webhook, webhookData.workflow, requestId)
            } catch (cleanupError) {
              logger.error(`Failed to cleanup external webhook during block deletion`, {
                webhookId: webhookData.webhook.id,
                workflowId: webhookData.workflow.id,
                userId: webhookData.workflow.userId,
                workspaceId: webhookData.workflow.workspaceId,
                provider: webhookData.webhook.provider,
                blockId: webhookData.webhook.blockId,
                error: cleanupError,
              })
              // Continue with deletion even if cleanup fails
            }
          }
        }
      } catch (webhookCleanupError) {
        logger.error(`Error during webhook cleanup for block deletion (continuing with deletion)`, {
          workflowId,
          blockIds: Array.from(blocksToDelete),
          error: webhookCleanupError,
        })
        // Continue with block deletion even if webhook cleanup fails
      }

      // Remove any edges connected to this block
      await tx
        .delete(workflowEdges)
        .where(
          and(
            eq(workflowEdges.workflowId, workflowId),
            or(
              eq(workflowEdges.sourceBlockId, payload.id),
              eq(workflowEdges.targetBlockId, payload.id)
            )
          )
        )

      // Finally remove the block itself
      await tx
        .delete(workflowBlocks)
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))

      // If this block had a parent, update the parent's subflow node list
      if (blockToRemove.length > 0 && blockToRemove[0].parentId) {
        await updateSubflowNodeList(tx, workflowId, blockToRemove[0].parentId)
      }

      logger.debug(`Removed block ${payload.id} and its connections from workflow ${workflowId}`)
      break
    }

    case 'update-name': {
      if (!payload.id || !payload.name) {
        throw new Error('Missing required fields for update name operation')
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          name: payload.name,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(`Updated block name: ${payload.id} -> "${payload.name}"`)
      break
    }

    case 'toggle-enabled': {
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

    case 'update-parent': {
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
      const updatedData = isRemovingFromParent
        ? {} // Clear data entirely when removing from parent
        : {
            ...currentData,
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

    case 'update-advanced-mode': {
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

    case 'update-trigger-mode': {
      if (!payload.id || payload.triggerMode === undefined) {
        throw new Error('Missing required fields for update trigger mode operation')
      }

      const updateResult = await tx
        .update(workflowBlocks)
        .set({
          triggerMode: payload.triggerMode,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        .returning({ id: workflowBlocks.id })

      if (updateResult.length === 0) {
        throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(`Updated block trigger mode: ${payload.id} -> ${payload.triggerMode}`)
      break
    }

    case 'toggle-handles': {
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

    case 'duplicate': {
      // Validate required fields for duplicate operation
      if (!payload.sourceId || !payload.id || !payload.type || !payload.name || !payload.position) {
        throw new Error('Missing required fields for duplicate block operation')
      }

      logger.debug(`Duplicating block: ${payload.type} (${payload.sourceId} -> ${payload.id})`, {
        isSubflowType: isSubflowBlockType(payload.type),
        payload,
      })

      // Extract parentId and extent from payload
      const parentId = payload.parentId || null
      const extent = payload.extent || null

      try {
        const insertData = {
          id: payload.id,
          workflowId,
          type: payload.type,
          name: payload.name,
          positionX: payload.position.x,
          positionY: payload.position.y,
          data: {
            ...(payload.data || {}),
            ...(parentId ? { parentId } : {}),
            ...(extent ? { extent } : {}),
          },
          subBlocks: payload.subBlocks || {},
          outputs: payload.outputs || {},
          enabled: payload.enabled ?? true,
          horizontalHandles: payload.horizontalHandles ?? true,
          advancedMode: payload.advancedMode ?? false,
          triggerMode: payload.triggerMode ?? false,
          height: payload.height || 0,
        }

        await tx.insert(workflowBlocks).values(insertData)

        // Handle auto-connect edge if present
        await insertAutoConnectEdge(tx, workflowId, payload.autoConnectEdge, logger)
      } catch (insertError) {
        logger.error(`❌ Failed to insert duplicated block ${payload.id}:`, insertError)
        throw insertError
      }

      // Auto-create subflow entry for loop/parallel blocks
      if (isSubflowBlockType(payload.type)) {
        try {
          const subflowConfig =
            payload.type === SubflowType.LOOP
              ? {
                  id: payload.id,
                  nodes: [], // Empty initially, will be populated when child blocks are added
                  iterations: payload.data?.count || DEFAULT_LOOP_ITERATIONS,
                  loopType: payload.data?.loopType || 'for',
                  // Set the appropriate field based on loop type
                  ...(payload.data?.loopType === 'while'
                    ? { whileCondition: payload.data?.whileCondition || '' }
                    : payload.data?.loopType === 'doWhile'
                      ? { doWhileCondition: payload.data?.doWhileCondition || '' }
                      : { forEachItems: payload.data?.collection || '' }),
                }
              : {
                  id: payload.id,
                  nodes: [], // Empty initially, will be populated when child blocks are added
                  distribution: payload.data?.collection || '',
                }

          logger.debug(
            `Auto-creating ${payload.type} subflow for duplicated block ${payload.id}:`,
            subflowConfig
          )

          await tx.insert(workflowSubflows).values({
            id: payload.id,
            workflowId,
            type: payload.type,
            config: subflowConfig,
          })
        } catch (subflowError) {
          logger.error(
            `❌ Failed to create ${payload.type} subflow for duplicated block ${payload.id}:`,
            subflowError
          )
          throw subflowError
        }
      }

      // If this block has a parent, update the parent's subflow node list
      if (parentId) {
        await updateSubflowNodeList(tx, workflowId, parentId)
      }

      logger.debug(
        `Duplicated block ${payload.sourceId} -> ${payload.id} (${payload.type}) in workflow ${workflowId}`
      )
      break
    }

    // Add other block operations as needed
    default:
      logger.warn(`Unknown block operation: ${operation}`)
      throw new Error(`Unsupported block operation: ${operation}`)
  }
}

// Edge operations
async function handleEdgeOperationTx(tx: any, workflowId: string, operation: string, payload: any) {
  switch (operation) {
    case 'add': {
      // Validate required fields
      if (!payload.id || !payload.source || !payload.target) {
        throw new Error('Missing required fields for add edge operation')
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

    case 'remove': {
      if (!payload.id) {
        throw new Error('Missing edge ID for remove operation')
      }

      const deleteResult = await tx
        .delete(workflowEdges)
        .where(and(eq(workflowEdges.id, payload.id), eq(workflowEdges.workflowId, workflowId)))
        .returning({ id: workflowEdges.id })

      if (deleteResult.length === 0) {
        throw new Error(`Edge ${payload.id} not found in workflow ${workflowId}`)
      }

      logger.debug(`Removed edge ${payload.id} from workflow ${workflowId}`)
      break
    }

    default:
      logger.warn(`Unknown edge operation: ${operation}`)
      throw new Error(`Unsupported edge operation: ${operation}`)
  }
}

async function handleSubflowOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any
) {
  switch (operation) {
    case 'update': {
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
    case 'add': {
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

    case 'remove': {
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

    case 'duplicate': {
      if (!payload.sourceVariableId || !payload.id) {
        throw new Error('Missing required fields for duplicate variable operation')
      }

      const sourceVariable = currentVariables[payload.sourceVariableId]
      if (!sourceVariable) {
        throw new Error(`Source variable ${payload.sourceVariableId} not found`)
      }

      // Create duplicated variable with unique name
      const baseName = `${sourceVariable.name} (copy)`
      let uniqueName = baseName
      let nameIndex = 1

      // Ensure name uniqueness
      const existingNames = Object.values(currentVariables).map((v: any) => v.name)
      while (existingNames.includes(uniqueName)) {
        uniqueName = `${baseName} (${nameIndex})`
        nameIndex++
      }

      const duplicatedVariable = {
        ...sourceVariable,
        id: payload.id,
        name: uniqueName,
      }

      const updatedVariables = {
        ...currentVariables,
        [payload.id]: duplicatedVariable,
      }

      await tx
        .update(workflow)
        .set({
          variables: updatedVariables,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, workflowId))

      logger.debug(
        `Duplicated variable ${payload.sourceVariableId} -> ${payload.id} (${uniqueName}) in workflow ${workflowId}`
      )
      break
    }

    default:
      logger.warn(`Unknown variable operation: ${operation}`)
      throw new Error(`Unsupported variable operation: ${operation}`)
  }
}

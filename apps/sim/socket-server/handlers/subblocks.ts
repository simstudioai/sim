import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { workflow, workflowBlocks } from '../../db/schema'
import { createLogger } from '../../lib/logs/console-logger'
import type { AuthenticatedSocket } from '../middleware/auth'
import type { RoomManager } from '../rooms/manager'
import type { HandlerDependencies } from './workflow'

const logger = createLogger('SubblocksHandlers')

export function setupSubblocksHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  socket.on('subblock-update', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring subblock update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { blockId, subblockId, value, timestamp, operationId } = data
    const room = roomManager.getWorkflowRoom(workflowId)

    if (!room) {
      logger.debug(`Ignoring subblock update: workflow room not found`, {
        socketId: socket.id,
        workflowId,
        blockId,
        subblockId,
      })
      return
    }

    try {
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      // First, verify that the workflow still exists in the database
      const workflowExists = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (workflowExists.length === 0) {
        logger.warn(`Ignoring subblock update: workflow ${workflowId} no longer exists`, {
          socketId: socket.id,
          blockId,
          subblockId,
        })
        roomManager.cleanupUserFromRoom(socket.id, workflowId)
        return
      }

      let updateSuccessful = false
      await db.transaction(async (tx) => {
        const [block] = await tx
          .select({ subBlocks: workflowBlocks.subBlocks })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (!block) {
          // Block was deleted - this is a normal race condition in collaborative editing
          logger.debug(
            `Ignoring subblock update for deleted block: ${workflowId}/${blockId}.${subblockId}`
          )
          return
        }

        const subBlocks = (block.subBlocks as any) || {}

        if (!subBlocks[subblockId]) {
          // Create new subblock with minimal structure
          subBlocks[subblockId] = {
            id: subblockId,
            type: 'unknown', // Will be corrected by next collaborative update
            value: value,
          }
        } else {
          // Preserve existing id and type, only update value
          subBlocks[subblockId] = {
            ...subBlocks[subblockId],
            value: value,
          }
        }

        await tx
          .update(workflowBlocks)
          .set({
            subBlocks: subBlocks,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))

        updateSuccessful = true
      })

      // Only broadcast to other clients if the update was successful
      if (updateSuccessful) {
        socket.to(workflowId).emit('subblock-update', {
          blockId,
          subblockId,
          value,
          timestamp,
          senderId: socket.id,
          userId: session.userId,
        })

        // Emit confirmation if operationId is provided
        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        logger.debug(`Subblock update in workflow ${workflowId}: ${blockId}.${subblockId}`)
      } else if (operationId) {
        // Block was deleted - notify client that operation completed (but didn't update anything)
        socket.emit('operation-failed', {
          operationId,
          error: 'Block no longer exists',
          retryable: false, // No point retrying for deleted blocks
        })
      }
    } catch (error) {
      logger.error('Error handling subblock update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Emit operation-failed for queue-tracked operations
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true, // Subblock updates are generally retryable
        })
      }

      // Also emit legacy operation-error for backward compatibility
      socket.emit('operation-error', {
        type: 'SUBBLOCK_UPDATE_FAILED',
        message: `Failed to update subblock ${blockId}.${subblockId}: ${errorMessage}`,
        operation: 'subblock-update',
        target: 'subblock',
      })
    }
  })
}

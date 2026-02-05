import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

const logger = createLogger('SubblocksHandlers')

/** Debounce interval for coalescing rapid subblock updates before persisting */
const DEBOUNCE_INTERVAL_MS = 25

type PendingSubblock = {
  latest: { blockId: string; subblockId: string; value: any; timestamp: number }
  timeout: NodeJS.Timeout
  // Map operationId -> socketId to emit confirmations/failures to correct clients
  opToSocket: Map<string, string>
}

// Keyed by `${workflowId}:${blockId}:${subblockId}`
const pendingSubblockUpdates = new Map<string, PendingSubblock>()

/**
 * Cleans up pending updates for a disconnected socket.
 * Removes the socket's operationIds from pending updates to prevent memory leaks.
 */
export function cleanupPendingSubblocksForSocket(socketId: string): void {
  for (const [, pending] of pendingSubblockUpdates.entries()) {
    // Remove this socket's operation entries
    for (const [opId, sid] of pending.opToSocket.entries()) {
      if (sid === socketId) {
        pending.opToSocket.delete(opId)
      }
    }
    // If no more operations are waiting, the timeout will still fire and flush
    // This is fine - the update will still persist, just no confirmation to send
  }
}

export function setupSubblocksHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('subblock-update', async (data) => {
    const {
      workflowId: payloadWorkflowId,
      blockId,
      subblockId,
      value,
      timestamp,
      operationId,
    } = data

    if (!roomManager.isReady()) {
      socket.emit('operation-forbidden', {
        type: 'ROOM_MANAGER_UNAVAILABLE',
        message: 'Realtime unavailable',
      })
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: 'Realtime unavailable',
          retryable: true,
        })
      }
      return
    }

    try {
      const sessionWorkflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      const session = await roomManager.getUserSession(socket.id)

      if (!sessionWorkflowId || !session) {
        logger.debug(`Ignoring subblock update: socket not connected to any workflow room`, {
          socketId: socket.id,
          hasWorkflowId: !!sessionWorkflowId,
          hasSession: !!session,
        })
        socket.emit('operation-forbidden', {
          type: 'SESSION_ERROR',
          message: 'Session expired, please rejoin workflow',
        })
        if (operationId) {
          socket.emit('operation-failed', { operationId, error: 'Session expired' })
        }
        return
      }

      const workflowId = payloadWorkflowId || sessionWorkflowId

      if (payloadWorkflowId && payloadWorkflowId !== sessionWorkflowId) {
        logger.warn('Workflow ID mismatch in subblock update', {
          payloadWorkflowId,
          sessionWorkflowId,
          socketId: socket.id,
        })
        if (operationId) {
          socket.emit('operation-failed', {
            operationId,
            error: 'Workflow ID mismatch',
            retryable: true,
          })
        }
        return
      }

      const hasRoom = await roomManager.hasWorkflowRoom(workflowId)
      if (!hasRoom) {
        logger.debug(`Ignoring subblock update: workflow room not found`, {
          socketId: socket.id,
          workflowId,
          blockId,
          subblockId,
        })
        return
      }

      // Update user activity
      await roomManager.updateUserActivity(workflowId, socket.id, { lastActivity: Date.now() })

      // Server-side debounce/coalesce by workflowId+blockId+subblockId
      const debouncedKey = `${workflowId}:${blockId}:${subblockId}`
      const existing = pendingSubblockUpdates.get(debouncedKey)
      if (existing) {
        clearTimeout(existing.timeout)
        existing.latest = { blockId, subblockId, value, timestamp }
        if (operationId) existing.opToSocket.set(operationId, socket.id)
        existing.timeout = setTimeout(async () => {
          await flushSubblockUpdate(workflowId, existing, roomManager)
          pendingSubblockUpdates.delete(debouncedKey)
        }, DEBOUNCE_INTERVAL_MS)
      } else {
        const opToSocket = new Map<string, string>()
        if (operationId) opToSocket.set(operationId, socket.id)
        const timeout = setTimeout(async () => {
          const pending = pendingSubblockUpdates.get(debouncedKey)
          if (pending) {
            await flushSubblockUpdate(workflowId, pending, roomManager)
            pendingSubblockUpdates.delete(debouncedKey)
          }
        }, DEBOUNCE_INTERVAL_MS)
        pendingSubblockUpdates.set(debouncedKey, {
          latest: { blockId, subblockId, value, timestamp },
          timeout,
          opToSocket,
        })
      }
    } catch (error) {
      logger.error('Error handling subblock update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true,
        })
      }

      socket.emit('operation-error', {
        type: 'SUBBLOCK_UPDATE_FAILED',
        message: `Failed to update subblock ${blockId}.${subblockId}: ${errorMessage}`,
        operation: 'subblock-update',
        target: 'subblock',
      })
    }
  })
}

async function flushSubblockUpdate(
  workflowId: string,
  pending: PendingSubblock,
  roomManager: IRoomManager
) {
  const { blockId, subblockId, value, timestamp } = pending.latest
  const io = roomManager.io

  try {
    // Verify workflow still exists
    const workflowExists = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowExists.length === 0) {
      pending.opToSocket.forEach((socketId, opId) => {
        io.to(socketId).emit('operation-failed', {
          operationId: opId,
          error: 'Workflow not found',
          retryable: false,
        })
      })
      return
    }

    let updateSuccessful = false
    await db.transaction(async (tx) => {
      const [block] = await tx
        .select({
          subBlocks: workflowBlocks.subBlocks,
          locked: workflowBlocks.locked,
          data: workflowBlocks.data,
        })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      if (!block) {
        return
      }

      // Check if block is locked directly
      if (block.locked) {
        logger.info(`Skipping subblock update - block ${blockId} is locked`)
        return
      }

      // Check if block is inside a locked parent container
      const parentId = (block.data as Record<string, unknown> | null)?.parentId as
        | string
        | undefined
      if (parentId) {
        const [parentBlock] = await tx
          .select({ locked: workflowBlocks.locked })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, parentId), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (parentBlock?.locked) {
          logger.info(`Skipping subblock update - parent ${parentId} is locked`)
          return
        }
      }

      const subBlocks = (block.subBlocks as any) || {}
      if (!subBlocks[subblockId]) {
        subBlocks[subblockId] = { id: subblockId, type: 'unknown', value }
      } else {
        subBlocks[subblockId] = { ...subBlocks[subblockId], value }
      }

      await tx
        .update(workflowBlocks)
        .set({ subBlocks, updatedAt: new Date() })
        .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))

      updateSuccessful = true
    })

    if (updateSuccessful) {
      // Broadcast to room excluding all senders (works cross-pod via Redis adapter)
      const senderSocketIds = [...pending.opToSocket.values()]
      const broadcastPayload = {
        workflowId,
        blockId,
        subblockId,
        value,
        timestamp,
      }
      if (senderSocketIds.length > 0) {
        io.to(workflowId).except(senderSocketIds).emit('subblock-update', broadcastPayload)
      } else {
        io.to(workflowId).emit('subblock-update', broadcastPayload)
      }

      // Confirm all coalesced operationIds (io.to(socketId) works cross-pod)
      pending.opToSocket.forEach((socketId, opId) => {
        io.to(socketId).emit('operation-confirmed', {
          operationId: opId,
          serverTimestamp: Date.now(),
        })
      })
    } else {
      pending.opToSocket.forEach((socketId, opId) => {
        io.to(socketId).emit('operation-failed', {
          operationId: opId,
          error: 'Block no longer exists',
          retryable: false,
        })
      })
    }
  } catch (error) {
    logger.error('Error flushing subblock update:', error)
    pending.opToSocket.forEach((socketId, opId) => {
      io.to(socketId).emit('operation-failed', {
        operationId: opId,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      })
    })
  }
}

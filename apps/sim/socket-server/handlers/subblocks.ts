import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('SubblocksHandlers')

type PendingSubblock = {
  latest: { blockId: string; subblockId: string; value: any; timestamp: number }
  timeout: NodeJS.Timeout
  // Map operationId -> socketId to emit confirmations/failures to correct clients
  opToSocket: Map<string, string>
}

// Keyed by `${workflowId}:${blockId}:${subblockId}`
const pendingSubblockUpdates = new Map<string, PendingSubblock>()

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
        }, 25)
      } else {
        const opToSocket = new Map<string, string>()
        if (operationId) opToSocket.set(operationId, socket.id)
        const timeout = setTimeout(async () => {
          const pending = pendingSubblockUpdates.get(debouncedKey)
          if (pending) {
            await flushSubblockUpdate(workflowId, pending, roomManager)
            pendingSubblockUpdates.delete(debouncedKey)
          }
        }, 25)
        pendingSubblockUpdates.set(debouncedKey, {
          latest: { blockId, subblockId, value, timestamp },
          timeout,
          opToSocket,
        })
      }
    } catch (error) {
      logger.error('Error handling subblock update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Best-effort failure for the single operation if provided
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true,
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

async function flushSubblockUpdate(
  workflowId: string,
  pending: PendingSubblock,
  roomManager: RoomManager
) {
  const { blockId, subblockId, value, timestamp } = pending.latest
  try {
    // Verify workflow still exists
    const workflowExists = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowExists.length === 0) {
      pending.opToSocket.forEach((socketId, opId) => {
        const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
        if (sock) {
          sock.emit('operation-failed', {
            operationId: opId,
            error: 'Workflow not found',
            retryable: false,
          })
        }
      })
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
        return
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
      // Broadcast to other clients (exclude senders to avoid overwriting their local state)
      const senderSocketIds = new Set(pending.opToSocket.values())
      const io = (roomManager as any).io
      if (io) {
        // Get all sockets in the room
        const roomSockets = io.sockets.adapter.rooms.get(workflowId)
        if (roomSockets) {
          roomSockets.forEach((socketId: string) => {
            // Only emit to sockets that didn't send any of the coalesced ops
            if (!senderSocketIds.has(socketId)) {
              const sock = io.sockets.sockets.get(socketId)
              if (sock) {
                sock.emit('subblock-update', {
                  blockId,
                  subblockId,
                  value,
                  timestamp,
                })
              }
            }
          })
        }
      }

      // Confirm all coalesced operationIds
      pending.opToSocket.forEach((socketId, opId) => {
        const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
        if (sock) {
          sock.emit('operation-confirmed', { operationId: opId, serverTimestamp: Date.now() })
        }
      })

      logger.debug(`Flushed subblock update ${workflowId}: ${blockId}.${subblockId}`)
    } else {
      pending.opToSocket.forEach((socketId, opId) => {
        const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
        if (sock) {
          sock.emit('operation-failed', {
            operationId: opId,
            error: 'Block no longer exists',
            retryable: false,
          })
        }
      })
    }
  } catch (error) {
    logger.error('Error flushing subblock update:', error)
    pending.opToSocket.forEach((socketId, opId) => {
      const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
      if (sock) {
        sock.emit('operation-failed', {
          operationId: opId,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        })
      }
    })
  }
}

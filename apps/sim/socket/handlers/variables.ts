import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

const logger = createLogger('VariablesHandlers')

/** Debounce interval for coalescing rapid variable updates before persisting */
const DEBOUNCE_INTERVAL_MS = 25

type PendingVariable = {
  latest: { variableId: string; field: string; value: any; timestamp: number }
  timeout: NodeJS.Timeout
  opToSocket: Map<string, string>
}

// Keyed by `${workflowId}:${variableId}:${field}`
const pendingVariableUpdates = new Map<string, PendingVariable>()

/**
 * Cleans up pending updates for a disconnected socket.
 * Removes the socket's operationIds from pending updates to prevent memory leaks.
 */
export function cleanupPendingVariablesForSocket(socketId: string): void {
  for (const [, pending] of pendingVariableUpdates.entries()) {
    for (const [opId, sid] of pending.opToSocket.entries()) {
      if (sid === socketId) {
        pending.opToSocket.delete(opId)
      }
    }
  }
}

export function setupVariablesHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('variable-update', async (data) => {
    const { workflowId: payloadWorkflowId, variableId, field, value, timestamp, operationId } = data

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
        logger.debug(`Ignoring variable update: socket not connected to any workflow room`, {
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
        logger.warn('Workflow ID mismatch in variable update', {
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
        logger.debug(`Ignoring variable update: workflow room not found`, {
          socketId: socket.id,
          workflowId,
          variableId,
          field,
        })
        return
      }

      // Update user activity
      await roomManager.updateUserActivity(workflowId, socket.id, { lastActivity: Date.now() })

      const debouncedKey = `${workflowId}:${variableId}:${field}`
      const existing = pendingVariableUpdates.get(debouncedKey)
      if (existing) {
        clearTimeout(existing.timeout)
        existing.latest = { variableId, field, value, timestamp }
        if (operationId) existing.opToSocket.set(operationId, socket.id)
        existing.timeout = setTimeout(async () => {
          await flushVariableUpdate(workflowId, existing, roomManager)
          pendingVariableUpdates.delete(debouncedKey)
        }, DEBOUNCE_INTERVAL_MS)
      } else {
        const opToSocket = new Map<string, string>()
        if (operationId) opToSocket.set(operationId, socket.id)
        const timeout = setTimeout(async () => {
          const pending = pendingVariableUpdates.get(debouncedKey)
          if (pending) {
            await flushVariableUpdate(workflowId, pending, roomManager)
            pendingVariableUpdates.delete(debouncedKey)
          }
        }, DEBOUNCE_INTERVAL_MS)
        pendingVariableUpdates.set(debouncedKey, {
          latest: { variableId, field, value, timestamp },
          timeout,
          opToSocket,
        })
      }
    } catch (error) {
      logger.error('Error handling variable update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true,
        })
      }

      socket.emit('operation-error', {
        type: 'VARIABLE_UPDATE_FAILED',
        message: `Failed to update variable ${variableId}.${field}: ${errorMessage}`,
        operation: 'variable-update',
        target: 'variable',
      })
    }
  })
}

async function flushVariableUpdate(
  workflowId: string,
  pending: PendingVariable,
  roomManager: IRoomManager
) {
  const { variableId, field, value, timestamp } = pending.latest
  const io = roomManager.io

  try {
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
      const [workflowRecord] = await tx
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        return
      }

      const variables = (workflowRecord.variables as any) || {}
      if (!variables[variableId]) {
        return
      }

      variables[variableId] = {
        ...variables[variableId],
        [field]: value,
      }

      await tx
        .update(workflow)
        .set({ variables, updatedAt: new Date() })
        .where(eq(workflow.id, workflowId))

      updateSuccessful = true
    })

    if (updateSuccessful) {
      // Broadcast to room excluding all senders (works cross-pod via Redis adapter)
      const senderSocketIds = [...pending.opToSocket.values()]
      const broadcastPayload = {
        workflowId,
        variableId,
        field,
        value,
        timestamp,
      }
      if (senderSocketIds.length > 0) {
        io.to(workflowId).except(senderSocketIds).emit('variable-update', broadcastPayload)
      } else {
        io.to(workflowId).emit('variable-update', broadcastPayload)
      }

      // Confirm all coalesced operationIds (io.to(socketId) works cross-pod)
      pending.opToSocket.forEach((socketId, opId) => {
        io.to(socketId).emit('operation-confirmed', {
          operationId: opId,
          serverTimestamp: Date.now(),
        })
      })

      logger.debug(`Flushed variable update ${workflowId}: ${variableId}.${field}`)
    } else {
      pending.opToSocket.forEach((socketId, opId) => {
        io.to(socketId).emit('operation-failed', {
          operationId: opId,
          error: 'Variable no longer exists',
          retryable: false,
        })
      })
    }
  } catch (error) {
    logger.error('Error flushing variable update:', error)
    pending.opToSocket.forEach((socketId, opId) => {
      io.to(socketId).emit('operation-failed', {
        operationId: opId,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      })
    })
  }
}

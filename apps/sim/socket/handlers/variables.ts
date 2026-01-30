import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

const logger = createLogger('VariablesHandlers')

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
  for (const [key, pending] of pendingVariableUpdates.entries()) {
    for (const [opId, sid] of pending.opToSocket.entries()) {
      if (sid === socketId) {
        pending.opToSocket.delete(opId)
      }
    }
  }
}

export function setupVariablesHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('variable-update', async (data) => {
    const workflowId = await roomManager.getWorkflowIdForSocket(socket.id)
    const session = await roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring variable update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { variableId, field, value, timestamp, operationId } = data

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

    try {
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
        }, 25)
      } else {
        const opToSocket = new Map<string, string>()
        if (operationId) opToSocket.set(operationId, socket.id)
        const timeout = setTimeout(async () => {
          const pending = pendingVariableUpdates.get(debouncedKey)
          if (pending) {
            await flushVariableUpdate(workflowId, pending, roomManager)
            pendingVariableUpdates.delete(debouncedKey)
          }
        }, 25)
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
        const sock = io.sockets.sockets.get(socketId)
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
      // Collect all sender socket IDs to exclude from broadcast
      const senderSocketIds = [...pending.opToSocket.values()]
      const firstSenderSocket =
        senderSocketIds.length > 0 ? io.sockets.sockets.get(senderSocketIds[0]) : null

      if (firstSenderSocket) {
        // socket.to(room).emit() excludes sender and broadcasts across all pods via Redis adapter
        firstSenderSocket.to(workflowId).emit('variable-update', {
          variableId,
          field,
          value,
          timestamp,
        })
      } else if (senderSocketIds.length > 0) {
        // Senders disconnected but we should still exclude them in case they reconnected
        // Use io.except() to exclude all sender socket IDs
        io.to(workflowId).except(senderSocketIds).emit('variable-update', {
          variableId,
          field,
          value,
          timestamp,
        })
      } else {
        // No senders tracked (edge case) - broadcast to all
        roomManager.emitToWorkflow(workflowId, 'variable-update', {
          variableId,
          field,
          value,
          timestamp,
        })
      }

      pending.opToSocket.forEach((socketId, opId) => {
        const sock = io.sockets.sockets.get(socketId)
        if (sock) {
          sock.emit('operation-confirmed', { operationId: opId, serverTimestamp: Date.now() })
        }
      })

      logger.debug(`Flushed variable update ${workflowId}: ${variableId}.${field}`)
    } else {
      pending.opToSocket.forEach((socketId, opId) => {
        const sock = io.sockets.sockets.get(socketId)
        if (sock) {
          sock.emit('operation-failed', {
            operationId: opId,
            error: 'Variable no longer exists',
            retryable: false,
          })
        }
      })
    }
  } catch (error) {
    logger.error('Error flushing variable update:', error)
    pending.opToSocket.forEach((socketId, opId) => {
      const sock = io.sockets.sockets.get(socketId)
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

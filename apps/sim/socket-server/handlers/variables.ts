import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('VariablesHandlers')

type PendingVariable = {
  latest: { variableId: string; field: string; value: any; timestamp: number }
  timeout: NodeJS.Timeout
  opToSocket: Map<string, string>
}

// Keyed by `${workflowId}:${variableId}:${field}`
const pendingVariableUpdates = new Map<string, PendingVariable>()

export function setupVariablesHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)

  socket.on('variable-update', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring variable update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { variableId, field, value, timestamp, operationId } = data
    const room = roomManager.getWorkflowRoom(workflowId)

    if (!room) {
      logger.debug(`Ignoring variable update: workflow room not found`, {
        socketId: socket.id,
        workflowId,
        variableId,
        field,
      })
      return
    }

    try {
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

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
  roomManager: RoomManager
) {
  const { variableId, field, value, timestamp } = pending.latest
  try {
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
      // Broadcast to other clients (exclude senders to avoid overwriting their local state)
      const senderSocketIds = new Set(pending.opToSocket.values())
      const io = (roomManager as any).io
      if (io) {
        const roomSockets = io.sockets.adapter.rooms.get(workflowId)
        if (roomSockets) {
          roomSockets.forEach((socketId: string) => {
            if (!senderSocketIds.has(socketId)) {
              const sock = io.sockets.sockets.get(socketId)
              if (sock) {
                sock.emit('variable-update', {
                  variableId,
                  field,
                  value,
                  timestamp,
                })
              }
            }
          })
        }
      }

      pending.opToSocket.forEach((socketId, opId) => {
        const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
        if (sock) {
          sock.emit('operation-confirmed', { operationId: opId, serverTimestamp: Date.now() })
        }
      })

      logger.debug(`Flushed variable update ${workflowId}: ${variableId}.${field}`)
    } else {
      pending.opToSocket.forEach((socketId, opId) => {
        const sock = (roomManager as any).io?.sockets?.sockets?.get(socketId)
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

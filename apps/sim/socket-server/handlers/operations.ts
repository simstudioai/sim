import { ZodError } from 'zod'
import { createLogger } from '../../lib/logs/console-logger'
import { persistWorkflowOperation } from '../database/operations'
import type { AuthenticatedSocket } from '../middleware/auth'
import { verifyOperationPermission } from '../middleware/permissions'
import type { RoomManager } from '../rooms/manager'
import { WorkflowOperationSchema } from '../validation/schemas'
import type { HandlerDependencies } from './workflow'

const logger = createLogger('OperationsHandlers')

// Simplified conflict resolution - just last-write-wins since we have normalized tables
function shouldAcceptOperation(operation: any, roomLastModified: number): boolean {
  // Accept all operations - with normalized tables, conflicts are very unlikely
  return true
}

export function setupOperationsHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  socket.on('workflow-operation', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      socket.emit('error', {
        type: 'NOT_JOINED',
        message: 'Not joined to any workflow',
      })
      return
    }

    const room = roomManager.getWorkflowRoom(workflowId)
    if (!room) {
      socket.emit('error', {
        type: 'ROOM_NOT_FOUND',
        message: 'Workflow room not found',
      })
      return
    }

    try {
      const validatedOperation = WorkflowOperationSchema.parse(data)
      const { operation, target, payload, timestamp } = validatedOperation

      if (!shouldAcceptOperation(validatedOperation, room.lastModified)) {
        socket.emit('operation-rejected', {
          type: 'OPERATION_REJECTED',
          message: 'Operation rejected',
          operation,
          target,
          serverTimestamp: Date.now(),
        })
        return
      }

      // Check operation permissions
      const permissionCheck = await verifyOperationPermission(
        session.userId,
        workflowId,
        operation,
        target
      )
      if (!permissionCheck.allowed) {
        logger.warn(
          `User ${session.userId} forbidden from ${operation} on ${target}: ${permissionCheck.reason}`
        )
        socket.emit('operation-forbidden', {
          type: 'INSUFFICIENT_PERMISSIONS',
          message: permissionCheck.reason || 'Insufficient permissions for this operation',
          operation,
          target,
        })
        return
      }

      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      // Persist to database with transaction (last-write-wins)
      const serverTimestamp = Date.now()
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: serverTimestamp,
        userId: session.userId,
      })

      room.lastModified = serverTimestamp

      const broadcastData = {
        operation,
        target,
        payload,
        timestamp: serverTimestamp,
        senderId: socket.id,
        userId: session.userId,
        userName: session.userName,
        // Add operation metadata for better client handling
        metadata: {
          workflowId,
          operationId: crypto.randomUUID(),
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      socket.emit('operation-confirmed', {
        operation,
        target,
        operationId: broadcastData.metadata.operationId,
        serverTimestamp,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        socket.emit('operation-error', {
          type: 'VALIDATION_ERROR',
          message: 'Invalid operation data',
          errors: error.errors,
          operation: data.operation,
          target: data.target,
        })
        logger.warn(`Validation error for operation from ${session.userId}:`, error.errors)
      } else if (error instanceof Error) {
        // Handle specific database errors
        if (error.message.includes('not found')) {
          socket.emit('operation-error', {
            type: 'RESOURCE_NOT_FOUND',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
          socket.emit('operation-error', {
            type: 'DUPLICATE_RESOURCE',
            message: 'Resource already exists',
            operation: data.operation,
            target: data.target,
          })
        } else {
          socket.emit('operation-error', {
            type: 'OPERATION_FAILED',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        }
        logger.error(
          `Operation error for ${session.userId} (${data.operation} on ${data.target}):`,
          error
        )
      } else {
        socket.emit('operation-error', {
          type: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred',
          operation: data.operation,
          target: data.target,
        })
        logger.error('Unknown error handling workflow operation:', error)
      }
    }
  })
}

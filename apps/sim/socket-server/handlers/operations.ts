import { ZodError } from 'zod'
import { createLogger } from '../../lib/logs/console-logger'
import { persistWorkflowOperation } from '../database/operations'
import type { AuthenticatedSocket } from '../middleware/auth'
import { verifyOperationPermission } from '../middleware/permissions'
import type { RoomManager } from '../rooms/manager'
import { WorkflowOperationSchema } from '../validation/schemas'
import type { HandlerDependencies } from './workflow'

const logger = createLogger('OperationsHandlers')

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

    let operationId: string | undefined

    try {
      const validatedOperation = WorkflowOperationSchema.parse(data)
      operationId = validatedOperation.operationId
      const { operation, target, payload, timestamp } = validatedOperation

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

      // For position updates, preserve client timestamp to maintain ordering
      // For other operations, use server timestamp for consistency
      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const operationTimestamp = isPositionUpdate ? timestamp : Date.now()

      // Broadcast first for position updates to minimize latency, then persist
      // For other operations, persist first for consistency
      if (isPositionUpdate) {
        // Broadcast position updates immediately for smooth real-time movement
        const broadcastData = {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: {
            workflowId,
            operationId: crypto.randomUUID(),
            isPositionUpdate: true,
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        // Persist position update asynchronously to avoid blocking real-time updates
        persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        }).catch((error) => {
          logger.error('Failed to persist position update:', error)
          // Emit failure for position updates if operationId is provided
          if (operationId) {
            socket.emit('operation-failed', {
              operationId,
              error: error instanceof Error ? error.message : 'Database persistence failed',
              retryable: true,
            })
          }
        })

        room.lastModified = Date.now()

        // Emit confirmation if operationId is provided
        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        return // Early return for position updates
      }

      // For non-position operations, persist first then broadcast
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: operationTimestamp,
        userId: session.userId,
      })

      room.lastModified = Date.now()

      const broadcastData = {
        operation,
        target,
        payload,
        timestamp: operationTimestamp, // Preserve client timestamp for position updates
        senderId: socket.id,
        userId: session.userId,
        userName: session.userName,
        // Add operation metadata for better client handling
        metadata: {
          workflowId,
          operationId: crypto.randomUUID(),
          isPositionUpdate, // Flag to help clients handle position updates specially
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      // Emit confirmation if operationId is provided
      if (operationId) {
        socket.emit('operation-confirmed', {
          operationId,
          serverTimestamp: Date.now(),
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      // Emit operation-failed for queue-tracked operations
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: !(error instanceof ZodError), // Don't retry validation errors
        })
      }

      // Also emit legacy operation-error for backward compatibility
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

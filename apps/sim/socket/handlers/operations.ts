import { createLogger } from '@sim/logger'
import { ZodError } from 'zod'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  VARIABLE_OPERATIONS,
  type VariableOperation,
  WORKFLOW_OPERATIONS,
} from '@/socket/constants'
import { persistWorkflowOperation } from '@/socket/database/operations'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import { checkRolePermission } from '@/socket/middleware/permissions'
import type { IRoomManager, UserSession } from '@/socket/rooms'
import { WorkflowOperationSchema } from '@/socket/validation/schemas'

const logger = createLogger('OperationsHandlers')

export function setupOperationsHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('workflow-operation', async (data) => {
    const emitOperationError = (
      forbidden: { type: string; message: string; operation?: string; target?: string },
      failed?: { error: string; retryable?: boolean }
    ) => {
      socket.emit('operation-forbidden', forbidden)
      if (failed && data?.operationId) {
        socket.emit('operation-failed', { operationId: data.operationId, ...failed })
      }
    }

    if (!roomManager.isReady()) {
      emitOperationError(
        { type: 'ROOM_MANAGER_UNAVAILABLE', message: 'Realtime unavailable' },
        { error: 'Realtime unavailable', retryable: true }
      )
      return
    }

    let workflowId: string | null = null
    let session: UserSession | null = null

    try {
      workflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      session = await roomManager.getUserSession(socket.id)
    } catch (error) {
      logger.error('Error loading session for workflow operation:', error)
      emitOperationError(
        { type: 'ROOM_MANAGER_UNAVAILABLE', message: 'Realtime unavailable' },
        { error: 'Realtime unavailable', retryable: true }
      )
      return
    }

    if (!workflowId || !session) {
      emitOperationError(
        { type: 'SESSION_ERROR', message: 'Session expired, please rejoin workflow' },
        { error: 'Session expired' }
      )
      return
    }

    let hasRoom = false
    try {
      hasRoom = await roomManager.hasWorkflowRoom(workflowId)
    } catch (error) {
      logger.error('Error checking workflow room:', error)
      emitOperationError(
        { type: 'ROOM_MANAGER_UNAVAILABLE', message: 'Realtime unavailable' },
        { error: 'Realtime unavailable', retryable: true }
      )
      return
    }
    if (!hasRoom) {
      emitOperationError(
        { type: 'ROOM_NOT_FOUND', message: 'Workflow room not found' },
        { error: 'Workflow room not found' }
      )
      return
    }

    let operationId: string | undefined

    try {
      const validatedOperation = WorkflowOperationSchema.parse(data)
      operationId = validatedOperation.operationId
      const { operation, target, payload, timestamp } = validatedOperation

      // For position updates, preserve client timestamp to maintain ordering
      // For other operations, use server timestamp for consistency
      const isPositionUpdate =
        operation === BLOCK_OPERATIONS.UPDATE_POSITION && target === OPERATION_TARGETS.BLOCK
      const commitPositionUpdate =
        isPositionUpdate && 'commit' in payload ? payload.commit === true : false
      const operationTimestamp = isPositionUpdate ? timestamp : Date.now()

      // Get user presence for permission checking
      const users = await roomManager.getWorkflowUsers(workflowId)
      const userPresence = users.find((u) => u.socketId === socket.id)

      // Skip permission checks for non-committed position updates (broadcasts only, no persistence)
      if (isPositionUpdate && !commitPositionUpdate) {
        // Update last activity
        if (userPresence) {
          await roomManager.updateUserActivity(workflowId, socket.id, { lastActivity: Date.now() })
        }
      } else {
        // Check permissions from cached role for all other operations
        if (!userPresence) {
          logger.warn(`User presence not found for socket ${socket.id}`)
          emitOperationError(
            {
              type: 'SESSION_ERROR',
              message: 'User session not found',
              operation,
              target,
            },
            { error: 'User session not found' }
          )
          return
        }

        await roomManager.updateUserActivity(workflowId, socket.id, { lastActivity: Date.now() })

        // Check permissions using cached role (no DB query)
        const permissionCheck = checkRolePermission(userPresence.role, operation)
        if (!permissionCheck.allowed) {
          logger.warn(
            `User ${session.userId} (role: ${userPresence.role}) forbidden from ${operation} on ${target}`
          )
          emitOperationError({
            type: 'INSUFFICIENT_PERMISSIONS',
            message: `${permissionCheck.reason} on '${target}'`,
            operation,
            target,
          })
          return
        }
      }

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

        if (!commitPositionUpdate) {
          return
        }

        try {
          await persistWorkflowOperation(workflowId, {
            operation,
            target,
            payload,
            timestamp: operationTimestamp,
            userId: session.userId,
          })
          await roomManager.updateRoomLastModified(workflowId)

          if (operationId) {
            socket.emit('operation-confirmed', {
              operationId,
              serverTimestamp: Date.now(),
            })
          }
        } catch (error) {
          logger.error('Failed to persist position update:', error)

          if (operationId) {
            socket.emit('operation-failed', {
              operationId,
              error: error instanceof Error ? error.message : 'Database persistence failed',
              retryable: true,
            })
          }
        }

        return
      }

      if (
        target === OPERATION_TARGETS.BLOCKS &&
        operation === BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS
      ) {
        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID(), isBatchPositionUpdate: true },
        })

        try {
          await persistWorkflowOperation(workflowId, {
            operation,
            target,
            payload,
            timestamp: operationTimestamp,
            userId: session.userId,
          })
          await roomManager.updateRoomLastModified(workflowId)

          if (operationId) {
            socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
          }
        } catch (error) {
          logger.error('Failed to persist batch position update:', error)
          if (operationId) {
            socket.emit('operation-failed', {
              operationId,
              error: error instanceof Error ? error.message : 'Database persistence failed',
              retryable: true,
            })
          }
        }

        return
      }

      if (
        target === OPERATION_TARGETS.VARIABLE &&
        ([VARIABLE_OPERATIONS.ADD, VARIABLE_OPERATIONS.REMOVE] as VariableOperation[]).includes(
          operation as VariableOperation
        )
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

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
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        return
      }

      if (
        target === OPERATION_TARGETS.WORKFLOW &&
        operation === WORKFLOW_OPERATIONS.REPLACE_STATE
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

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
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        return
      }

      if (target === OPERATION_TARGETS.BLOCKS && operation === BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (
        target === OPERATION_TARGETS.BLOCKS &&
        operation === BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (target === OPERATION_TARGETS.EDGES && operation === EDGES_OPERATIONS.BATCH_REMOVE_EDGES) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (
        target === OPERATION_TARGETS.BLOCKS &&
        operation === BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (
        target === OPERATION_TARGETS.BLOCKS &&
        operation === BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (
        target === OPERATION_TARGETS.BLOCKS &&
        operation === BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT
      ) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      if (target === OPERATION_TARGETS.EDGES && operation === EDGES_OPERATIONS.BATCH_ADD_EDGES) {
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        await roomManager.updateRoomLastModified(workflowId)

        socket.to(workflowId).emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: { workflowId, operationId: crypto.randomUUID() },
        })

        if (operationId) {
          socket.emit('operation-confirmed', { operationId, serverTimestamp: Date.now() })
        }

        return
      }

      // For non-position operations, persist first then broadcast
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: operationTimestamp,
        userId: session.userId,
      })

      await roomManager.updateRoomLastModified(workflowId)

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
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      if (operationId) {
        socket.emit('operation-confirmed', {
          operationId,
          serverTimestamp: Date.now(),
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: !(error instanceof ZodError),
        })
      }

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

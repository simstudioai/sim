import { createLogger } from '../../lib/logs/console/logger'
import { getWorkflowState } from '../database/operations'
import type { AuthenticatedSocket } from '../middleware/auth'
import { verifyWorkflowAccess } from '../middleware/permissions'
import type { RoomManager, UserPresence, WorkflowRoom } from '../rooms/manager'

const logger = createLogger('WorkflowHandlers')

export type { UserPresence, WorkflowRoom }

export interface HandlerDependencies {
  roomManager: RoomManager
}

export const createWorkflowRoom = (workflowId: string): WorkflowRoom => ({
  workflowId,
  users: new Map(),
  lastModified: Date.now(),
  activeConnections: 0,
})

export const cleanupUserFromRoom = (
  socketId: string,
  workflowId: string,
  roomManager: RoomManager
) => {
  roomManager.cleanupUserFromRoom(socketId, workflowId)
}

export function setupWorkflowHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  socket.on('join-workflow', async ({ workflowId }) => {
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        logger.warn(`Join workflow rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workflow-error', { error: 'Authentication required' })
        return
      }

      logger.info(`Join workflow request from ${userId} (${userName}) for workflow ${workflowId}`)

      try {
        const accessInfo = await verifyWorkflowAccess(userId, workflowId)
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workflow ${workflowId}`)
          socket.emit('join-workflow-error', { error: 'Access denied to workflow' })
          return
        }
      } catch (error) {
        logger.warn(`Error verifying workflow access for ${userId}:`, error)
        socket.emit('join-workflow-error', { error: 'Failed to verify workflow access' })
        return
      }

      // Ensure user only joins one workflow at a time
      const currentWorkflowId = roomManager.getWorkflowIdForSocket(socket.id)
      if (currentWorkflowId) {
        socket.leave(currentWorkflowId)
        roomManager.cleanupUserFromRoom(socket.id, currentWorkflowId)

        // Broadcast updated presence list to all remaining users
        roomManager.broadcastPresenceUpdate(currentWorkflowId)
      }

      socket.join(workflowId)

      if (!roomManager.hasWorkflowRoom(workflowId)) {
        roomManager.setWorkflowRoom(workflowId, roomManager.createWorkflowRoom(workflowId))
      }

      const room = roomManager.getWorkflowRoom(workflowId)!
      room.activeConnections++

      const userPresence: UserPresence = {
        userId,
        workflowId,
        userName,
        socketId: socket.id,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
      }

      room.users.set(socket.id, userPresence)
      roomManager.setWorkflowForSocket(socket.id, workflowId)
      roomManager.setUserSession(socket.id, { userId, userName })

      const workflowState = await getWorkflowState(workflowId)
      socket.emit('workflow-state', workflowState)

      // Broadcast updated presence list to all users in the room
      roomManager.broadcastPresenceUpdate(workflowId)

      const uniqueUserCount = roomManager.getUniqueUserCount(workflowId)
      logger.info(
        `User ${userId} (${userName}) joined workflow ${workflowId}. Room now has ${uniqueUserCount} unique users (${room.activeConnections} connections).`
      )
    } catch (error) {
      logger.error('Error joining workflow:', error)
      socket.emit('error', {
        type: 'JOIN_ERROR',
        message: 'Failed to join workflow',
      })
    }
  })

  socket.on('request-sync', async ({ workflowId }) => {
    try {
      if (!socket.userId) {
        socket.emit('error', { type: 'NOT_AUTHENTICATED', message: 'Not authenticated' })
        return
      }

      const accessInfo = await verifyWorkflowAccess(socket.userId, workflowId)
      if (!accessInfo.hasAccess) {
        socket.emit('error', { type: 'ACCESS_DENIED', message: 'Access denied' })
        return
      }

      const workflowState = await getWorkflowState(workflowId)
      socket.emit('workflow-state', workflowState)

      logger.info(`Sent sync data to ${socket.userId} for workflow ${workflowId}`)
    } catch (error) {
      logger.error('Error handling sync request:', error)
      socket.emit('error', { type: 'SYNC_FAILED', message: 'Failed to sync workflow state' })
    }
  })

  socket.on('leave-workflow', () => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (workflowId && session) {
      socket.leave(workflowId)
      roomManager.cleanupUserFromRoom(socket.id, workflowId)

      // Broadcast updated presence list to all remaining users
      roomManager.broadcastPresenceUpdate(workflowId)

      logger.info(`User ${session.userId} (${session.userName}) left workflow ${workflowId}`)
    }
  })
}

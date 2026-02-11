import { db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getWorkflowState } from '@/socket/database/operations'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import { verifyWorkflowAccess } from '@/socket/middleware/permissions'
import type { IRoomManager, UserPresence } from '@/socket/rooms'

const logger = createLogger('WorkflowHandlers')

export function setupWorkflowHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('join-workflow', async ({ workflowId, tabSessionId }) => {
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        logger.warn(`Join workflow rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workflow-error', { error: 'Authentication required' })
        return
      }

      if (!roomManager.isReady()) {
        logger.warn(`Join workflow rejected: Room manager unavailable`)
        socket.emit('join-workflow-error', {
          error: 'Realtime unavailable',
          code: 'ROOM_MANAGER_UNAVAILABLE',
        })
        return
      }

      logger.info(`Join workflow request from ${userId} (${userName}) for workflow ${workflowId}`)

      // Verify workflow access
      let userRole: string
      try {
        const accessInfo = await verifyWorkflowAccess(userId, workflowId)
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workflow ${workflowId}`)
          socket.emit('join-workflow-error', { error: 'Access denied to workflow' })
          return
        }
        userRole = accessInfo.role || 'read'
      } catch (error) {
        logger.warn(`Error verifying workflow access for ${userId}:`, error)
        socket.emit('join-workflow-error', { error: 'Failed to verify workflow access' })
        return
      }

      // Leave current room if in one
      const currentWorkflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      if (currentWorkflowId) {
        socket.leave(currentWorkflowId)
        await roomManager.removeUserFromRoom(socket.id, currentWorkflowId)
        await roomManager.broadcastPresenceUpdate(currentWorkflowId)
      }

      // Keep this above Redis socket key TTL (1h) so a normal idle user is not evicted too aggressively.
      const STALE_THRESHOLD_MS = 75 * 60 * 1000
      const now = Date.now()
      const existingUsers = await roomManager.getWorkflowUsers(workflowId)
      let liveSocketIds = new Set<string>()
      let canCheckLiveness = false

      try {
        const liveSockets = await roomManager.io.in(workflowId).fetchSockets()
        liveSocketIds = new Set(liveSockets.map((liveSocket) => liveSocket.id))
        canCheckLiveness = true
      } catch (error) {
        logger.warn(
          `Skipping stale cleanup for ${workflowId} due to live socket lookup failure`,
          error
        )
      }

      for (const existingUser of existingUsers) {
        try {
          if (existingUser.socketId === socket.id) {
            continue
          }

          const isSameTab = Boolean(
            existingUser.userId === userId &&
              tabSessionId &&
              existingUser.tabSessionId === tabSessionId
          )

          if (isSameTab) {
            logger.info(
              `Cleaning up socket ${existingUser.socketId} for user ${existingUser.userId} (same tab)`
            )
            await roomManager.removeUserFromRoom(existingUser.socketId, workflowId)
            await roomManager.io.in(existingUser.socketId).socketsLeave(workflowId)
            continue
          }

          if (!canCheckLiveness || liveSocketIds.has(existingUser.socketId)) {
            continue
          }

          const isStaleByActivity =
            now - (existingUser.lastActivity || existingUser.joinedAt || 0) > STALE_THRESHOLD_MS
          if (!isStaleByActivity) {
            continue
          }

          logger.info(
            `Cleaning up socket ${existingUser.socketId} for user ${existingUser.userId} (stale activity)`
          )
          await roomManager.removeUserFromRoom(existingUser.socketId, workflowId)
          await roomManager.io.in(existingUser.socketId).socketsLeave(workflowId)
        } catch (error) {
          logger.warn(`Best-effort cleanup failed for socket ${existingUser.socketId}`, error)
        }
      }

      // Join the new room
      socket.join(workflowId)

      // Get avatar URL
      let avatarUrl = socket.userImage || null
      if (!avatarUrl) {
        try {
          const [userRecord] = await db
            .select({ image: user.image })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1)

          avatarUrl = userRecord?.image ?? null
        } catch (error) {
          logger.warn('Failed to load user avatar for presence', { userId, error })
        }
      }

      // Create presence entry
      const userPresence: UserPresence = {
        userId,
        workflowId,
        userName,
        socketId: socket.id,
        tabSessionId,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: userRole,
        avatarUrl,
      }

      // Add user to room
      await roomManager.addUserToRoom(workflowId, socket.id, userPresence)

      // Get current presence list for the join acknowledgment
      const presenceUsers = await roomManager.getWorkflowUsers(workflowId)

      // Get workflow state
      const workflowState = await getWorkflowState(workflowId)

      // Send join success with presence list (client waits for this to confirm join)
      socket.emit('join-workflow-success', {
        workflowId,
        socketId: socket.id,
        presenceUsers,
      })

      // Send workflow state
      socket.emit('workflow-state', workflowState)

      // Broadcast presence update to all users in the room
      await roomManager.broadcastPresenceUpdate(workflowId)

      const uniqueUserCount = await roomManager.getUniqueUserCount(workflowId)
      logger.info(
        `User ${userId} (${userName}) joined workflow ${workflowId}. Room now has ${uniqueUserCount} unique users.`
      )
    } catch (error) {
      logger.error('Error joining workflow:', error)
      // Undo socket.join and room manager entry if any operation failed
      socket.leave(workflowId)
      await roomManager.removeUserFromRoom(socket.id, workflowId)
      const isReady = roomManager.isReady()
      socket.emit('join-workflow-error', {
        error: isReady ? 'Failed to join workflow' : 'Realtime unavailable',
        code: isReady ? undefined : 'ROOM_MANAGER_UNAVAILABLE',
      })
    }
  })

  socket.on('leave-workflow', async () => {
    try {
      if (!roomManager.isReady()) {
        return
      }

      const workflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      const session = await roomManager.getUserSession(socket.id)

      if (workflowId && session) {
        socket.leave(workflowId)
        await roomManager.removeUserFromRoom(socket.id, workflowId)
        await roomManager.broadcastPresenceUpdate(workflowId)

        logger.info(`User ${session.userId} (${session.userName}) left workflow ${workflowId}`)
      }
    } catch (error) {
      logger.error('Error leaving workflow:', error)
    }
  })
}

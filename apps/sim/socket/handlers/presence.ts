import { createLogger } from '@sim/logger'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

const logger = createLogger('PresenceHandlers')

export function setupPresenceHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('cursor-update', async ({ cursor }) => {
    try {
      const workflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      const session = await roomManager.getUserSession(socket.id)

      if (!workflowId || !session) return

      // Update cursor in room state
      await roomManager.updateUserActivity(workflowId, socket.id, { cursor })

      // Broadcast to other users in the room
      socket.to(workflowId).emit('cursor-update', {
        socketId: socket.id,
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl,
        cursor,
      })
    } catch (error) {
      logger.error(`Error handling cursor update for socket ${socket.id}:`, error)
    }
  })

  socket.on('selection-update', async ({ selection }) => {
    try {
      const workflowId = await roomManager.getWorkflowIdForSocket(socket.id)
      const session = await roomManager.getUserSession(socket.id)

      if (!workflowId || !session) return

      // Update selection in room state
      await roomManager.updateUserActivity(workflowId, socket.id, { selection })

      // Broadcast to other users in the room
      socket.to(workflowId).emit('selection-update', {
        socketId: socket.id,
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl,
        selection,
      })
    } catch (error) {
      logger.error(`Error handling selection update for socket ${socket.id}:`, error)
    }
  })
}

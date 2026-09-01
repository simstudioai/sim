import { createLogger } from '@sim/logger'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('PresenceHandlers')

export function setupPresenceHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('cursor-update', async ({ cursor }) => {
    try {
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      const session = await roomManager.getUserSession(socket.id)

      if (!room || !session) return

      // Update cursor in room state
      await roomManager.updateUserActivity(room, socket.id, { cursor })

      // Broadcast to other users in the room (workflow room name is the bare id)
      socket.to(room.id).emit('cursor-update', {
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
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      const session = await roomManager.getUserSession(socket.id)

      if (!room || !session) return

      // Update selection in room state
      await roomManager.updateUserActivity(room, socket.id, { selection })

      // Broadcast to other users in the room (workflow room name is the bare id)
      socket.to(room.id).emit('selection-update', {
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

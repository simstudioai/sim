import { createLogger } from '@sim/logger'
import { cleanupPendingSubblocksForSocket } from '@/handlers/subblocks'
import { cleanupPendingVariablesForSocket } from '@/handlers/variables'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('ConnectionHandlers')

export function setupConnectionHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
  })

  socket.conn.on('error', (error) => {
    logger.error(`Socket ${socket.id} connection error:`, error)
  })

  socket.on('disconnect', async (reason) => {
    try {
      // Clean up pending debounce entries for this socket to prevent memory leaks
      cleanupPendingSubblocksForSocket(socket.id)
      cleanupPendingVariablesForSocket(socket.id)

      // A socket may occupy multiple rooms (one per type). Remove it from all of
      // them and rebroadcast presence per room so no room leaks a stale entry.
      const removedRooms = await roomManager.removeSocketFromAllRooms(socket.id)

      for (const room of removedRooms) {
        await roomManager.broadcastPresenceUpdate(room)
      }

      if (removedRooms.length > 0) {
        const rooms = removedRooms.map((room) => `${room.type}:${room.id}`).join(', ')
        logger.info(`Socket ${socket.id} disconnected from [${rooms}] (reason: ${reason})`)
      }
    } catch (error) {
      logger.error(`Error handling disconnect for socket ${socket.id}:`, error)
    }
  })
}

import { createLogger } from '@sim/logger'
import { parseRoomName, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
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

  // `disconnecting` (not `disconnect`): here `socket.rooms` is still populated and
  // authoritative, so presence is cleaned up even if the Redis room-set key was
  // evicted or TTL-expired (which would leave the manager's stored rooms empty).
  socket.on('disconnecting', async (reason) => {
    try {
      // Clean up pending debounce entries for this socket to prevent memory leaks
      cleanupPendingSubblocksForSocket(socket.id)
      cleanupPendingVariablesForSocket(socket.id)

      // A socket may occupy multiple rooms (one per type). Remove it from every
      // room the manager knows about.
      const removedRooms = await roomManager.removeSocketFromAllRooms(socket.id)
      const handled = new Set(removedRooms.map((room) => roomName(room)))

      // Fallback: clean up any room the live Socket.IO membership still lists that
      // the manager's (possibly-evicted) state no longer tracked.
      const fallbackRooms: RoomRef[] = []
      for (const name of socket.rooms) {
        if (name === socket.id || handled.has(name)) continue
        const ref = parseRoomName(name)
        if (!ref) continue
        await roomManager.removeUserFromRoom(ref, socket.id)
        fallbackRooms.push(ref)
      }

      const allRooms = [...removedRooms, ...fallbackRooms]
      for (const room of allRooms) {
        await roomManager.broadcastPresenceUpdate(room)
      }

      if (allRooms.length > 0) {
        const rooms = allRooms.map((room) => `${room.type}:${room.id}`).join(', ')
        logger.info(`Socket ${socket.id} disconnected from [${rooms}] (reason: ${reason})`)
      }
    } catch (error) {
      logger.error(`Error handling disconnect for socket ${socket.id}:`, error)
    }
  })
}

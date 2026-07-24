import { createLogger } from '@sim/logger'
import { isSameRoom, parseRoomName, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
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

      // Union with the live Socket.IO membership (authoritative here, and it
      // survives a Redis eviction/TTL lapse that would leave the manager's tracked
      // rooms empty). Attempt removal for any room the manager didn't already
      // remove — best-effort, since a transient Redis error can't be recovered here.
      const wasInRooms = new Map<string, RoomRef>()
      for (const room of removedRooms) wasInRooms.set(roomName(room), room)
      for (const name of socket.rooms) {
        if (name === socket.id || wasInRooms.has(name)) continue
        const ref = parseRoomName(name)
        if (!ref) continue
        wasInRooms.set(name, ref)
        if (!removedRooms.some((room) => isSameRoom(room, ref))) {
          await roomManager.removeUserFromRoom(ref, socket.id)
        }
      }

      // Broadcast a correction to every room this socket was in, EXCLUDING this
      // socket — so it is never shown as a ghost collaborator even if its presence
      // entry outlived a failed removal (transient Redis error; the hashes have no
      // TTL). Any orphaned entry is additionally reclaimed by the next join's
      // stale-presence sweep.
      for (const room of wasInRooms.values()) {
        await roomManager.broadcastPresenceUpdate(room, socket.id)
      }

      if (wasInRooms.size > 0) {
        const rooms = Array.from(wasInRooms.values())
          .map((room) => `${room.type}:${room.id}`)
          .join(', ')
        logger.info(`Socket ${socket.id} disconnected from [${rooms}] (reason: ${reason})`)
      }
    } catch (error) {
      logger.error(`Error handling disconnect for socket ${socket.id}:`, error)
    }
  })
}

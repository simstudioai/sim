import { createLogger } from '@sim/logger'
import { parseRoomName, ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { cleanupFileDocForSocket } from '@/handlers/file-doc'
import { cleanupPendingSubblocksForSocket } from '@/handlers/subblocks'
import { cleanupPendingVariablesForSocket } from '@/handlers/variables'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('ConnectionHandlers')

/**
 * Room types whose presence lives in the room manager (Redis-backed), so a disconnect must
 * remove the socket + broadcast a correction. The workspace-files and file-doc rooms are
 * NOT here: workspace-files carries no presence (native Socket.IO membership only), and
 * file-doc broadcasts its own server-authenticated roster via `cleanupFileDocForSocket`.
 */
const PRESENCE_BEARING_TYPES = new Set<RoomRef['type']>([ROOM_TYPES.WORKFLOW, ROOM_TYPES.TABLE])

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
      // Snapshot the live Socket.IO room membership SYNCHRONOUSLY, before any
      // await: Socket.IO clears `socket.rooms` via leaveAll() as soon as the
      // synchronous portion of this `disconnecting` handler returns (i.e. at the
      // first await below), so reading it afterwards would see an empty set and
      // the eviction fallback would be dead.
      const liveRoomNames = [...socket.rooms]

      // Clean up pending debounce entries for this socket to prevent memory leaks
      cleanupPendingSubblocksForSocket(socket.id)
      cleanupPendingVariablesForSocket(socket.id)
      // Clear the socket's collaborative-document awareness (removes its caret for
      // everyone else) and drop the room if it was the last editor. `endOfLife` drops the
      // socket's join-generation entry — safe only here, on true disconnect (see cleanup).
      cleanupFileDocForSocket(socket.id, roomManager.io, true)

      // A socket may occupy multiple rooms (one per type). Remove it from every
      // room the manager knows about.
      const removedRooms = await roomManager.removeSocketFromAllRooms(socket.id)

      // Union with the snapshotted Socket.IO membership (authoritative, and it
      // survives a Redis eviction/TTL lapse that would leave the manager's tracked
      // rooms empty). Attempt removal for any room the manager didn't already
      // remove — best-effort, since a transient Redis error can't be recovered here.
      const wasInRooms = new Map<string, RoomRef>()
      for (const room of removedRooms) wasInRooms.set(roomName(room), room)
      for (const name of liveRoomNames) {
        // `wasInRooms.has(name)` already excludes every room the manager removed (same
        // room-name key via the roomName/parseRoomName bijection). Skip room types with no
        // manager-tracked presence (workspace-files, file-doc): removing there is a no-op and
        // broadcasting a correction would emit a dead presence-update no client listens to.
        if (name === socket.id || wasInRooms.has(name)) continue
        const ref = parseRoomName(name)
        if (!ref || !PRESENCE_BEARING_TYPES.has(ref.type)) continue
        wasInRooms.set(name, ref)
        await roomManager.removeUserFromRoom(ref, socket.id)
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

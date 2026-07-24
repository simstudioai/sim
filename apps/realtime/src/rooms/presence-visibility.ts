import { type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'

/**
 * Filters a room's stored presence down to what should actually be broadcast:
 * drops `excludeSocketId` (e.g. a socket mid-disconnect that is still connected),
 * then reconciles against the live Socket.IO membership so an entry orphaned by a
 * failed removal (the room hashes have no TTL) is never emitted as a ghost.
 *
 * Fail-safe: if the liveness lookup throws, or returns an empty set while we still
 * hold presence entries (a cross-pod `fetchSockets` timeout, not a truly empty
 * room), we emit the unfiltered list rather than hide everyone — a transient
 * ghost self-corrects on the next broadcast, but hiding live collaborators would
 * be a worse, visible failure.
 */
export async function filterVisiblePresence<T extends { socketId: string }>(
  io: Server,
  room: RoomRef,
  users: T[],
  excludeSocketId?: string
): Promise<T[]> {
  const candidates = excludeSocketId
    ? users.filter((user) => user.socketId !== excludeSocketId)
    : users

  try {
    const liveSockets = await io.in(roomName(room)).fetchSockets()
    if (liveSockets.length === 0) {
      return candidates
    }
    const liveIds = new Set(liveSockets.map((socket) => socket.id))
    return candidates.filter((user) => liveIds.has(user.socketId))
  } catch {
    return candidates
  }
}

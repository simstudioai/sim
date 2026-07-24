import { type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'
import type { IRoomManager } from '@/rooms/types'

/**
 * How stale a not-live presence entry must be before a join-time sweep reclaims
 * it. Kept above the 1h socket-key TTL so a normally-idle collaborator is never
 * evicted; only genuinely-orphaned entries (e.g. a crashed pod that never fired
 * `disconnecting`) are cleared. Matches the workflow join sweep.
 */
const STALE_PRESENCE_THRESHOLD_MS = 75 * 60 * 1000

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

/**
 * Reclaims orphaned presence entries in a room: any stored socket that is no
 * longer a live Socket.IO member AND has been idle past
 * {@link STALE_PRESENCE_THRESHOLD_MS} is removed. This is how a room-users hash
 * (which has no TTL) is bounded against ungraceful disconnects — a pod crash
 * fires no `disconnecting` event, so its entries would otherwise persist forever.
 * Run on join, like the workflow room does. No-op when the liveness lookup fails
 * (so a transient adapter blip can't evict live collaborators).
 */
export async function sweepStalePresence(manager: IRoomManager, room: RoomRef): Promise<void> {
  let liveIds: Set<string>
  try {
    const liveSockets = await manager.io.in(roomName(room)).fetchSockets()
    liveIds = new Set(liveSockets.map((socket) => socket.id))
  } catch {
    return
  }

  const now = Date.now()
  const users = await manager.getRoomUsers(room)
  for (const user of users) {
    if (liveIds.has(user.socketId)) continue
    const lastSeen = user.lastActivity || user.joinedAt || 0
    if (now - lastSeen > STALE_PRESENCE_THRESHOLD_MS) {
      await manager.removeUserFromRoom(room, user.socketId)
    }
  }
}

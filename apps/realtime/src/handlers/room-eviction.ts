import { createLogger } from '@sim/logger'
import type { RoomRef, RoomType } from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'

const logger = createLogger('RoomEviction')

/**
 * Drops whatever pod-local state a handler keeps for a socket in one of its rooms.
 * Called after the socket has already been removed from the Socket.IO room, so it
 * only has to reconcile the handler's own bookkeeping.
 */
export type RoomEvictionHandler = (socketId: string, room: RoomRef, io: Server) => void

const handlers = new Map<RoomType, RoomEvictionHandler>()

/**
 * Registers a room type's local-state cleanup for involuntary eviction (the access
 * re-validation sweep, or a per-frame gate that catches a revocation first).
 *
 * A registry rather than a direct import so the security-critical sweep stays
 * domain-neutral: it never has to know that a file-doc room keeps an in-memory
 * Y.Doc + ownership map while a table room keeps Redis presence. Handlers register
 * at module load, which every handler module does at bootstrap.
 */
export function registerRoomEvictionHandler(type: RoomType, handler: RoomEvictionHandler): void {
  handlers.set(type, handler)
}

/**
 * Runs the registered cleanup for an evicted socket, if the room type has one.
 * Never throws — an eviction has already taken effect (the socket left the room)
 * by the time this runs, so a failing cleanup must not unwind it.
 */
export function runRoomEvictionHandler(socketId: string, room: RoomRef, io: Server): void {
  const handler = handlers.get(room.type)
  if (!handler) return
  try {
    handler(socketId, room, io)
  } catch (error) {
    logger.warn(`Room eviction cleanup failed for socket ${socketId} on ${room.type}`, error)
  }
}

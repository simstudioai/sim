import { createLogger } from '@sim/logger'
import {
  ROOM_ACCESS_REVOKED_EVENT,
  type RoomAccessRevokedBroadcast,
} from '@sim/realtime-protocol/events'
import { type RoomRef, type RoomType, roomName } from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'
import type { AuthenticatedSocket } from '@/middleware/auth'

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

/** Enqueues a presence cleanup owed for an evicted socket. */
type EvictionCleanupSink = (socketId: string, room: RoomRef) => void

let evictionCleanupSink: EvictionCleanupSink | null = null

/**
 * Registers the retrying presence-cleanup lane (owned by the access-revalidation
 * sweep) that handler-initiated evictions hand failed cleanups to.
 *
 * An eviction removes the socket from the Socket.IO room synchronously, which is
 * also how the sweep discovers work — so once a handler evicts, the sweep can no
 * longer find that (socket, room) pair to retry a Redis removal that failed. This
 * sink is the handoff that keeps the sweep's retry semantics (re-join guard,
 * moved-room guard, no infinite retry) as the single implementation instead of a
 * second, subtly different retry loop per handler. Unset outside a running sweep,
 * where {@link requestEvictionCleanup} is a no-op.
 */
export function setEvictionCleanupSink(sink: EvictionCleanupSink | null): void {
  evictionCleanupSink = sink
}

/**
 * Asks the sweep's cleanup lane to (re)try presence removal for a socket already
 * evicted from `room`. Call only when the immediate best-effort removal failed —
 * the happy path stays immediate so peers see the departure without waiting for a
 * sweep tick.
 */
export function requestEvictionCleanup(socketId: string, room: RoomRef): void {
  evictionCleanupSink?.(socketId, room)
}

/**
 * Evicts one socket from one non-workflow room after a confirmed loss of access:
 * tell the client, stop it receiving room broadcasts, and drop the handler-local
 * state that would otherwise still accept its frames.
 *
 * The single eviction path shared by both enforcement points — the periodic
 * re-validation sweep and the per-frame gates that catch a revocation first — so
 * they cannot diverge on what "evicted" means. Everything here is synchronous and
 * pod-local; any Redis presence removal is the caller's own follow-up (the sweep
 * owns a retrying cleanup lane for it).
 *
 * Workflow rooms keep their own `access-revoked` wire event for client
 * compatibility and are deliberately not routed through here.
 */
export function evictSocketFromRoom(
  socket: AuthenticatedSocket,
  room: RoomRef,
  message: string,
  io: Server
): void {
  const payload: RoomAccessRevokedBroadcast = { room, message, timestamp: Date.now() }
  socket.emit(ROOM_ACCESS_REVOKED_EVENT, payload)
  socket.leave(roomName(room))
  runRoomEvictionHandler(socket.id, room, io)
  logger.info(
    `Revoked live access for user ${socket.userId} on ${roomName(room)} (socket ${socket.id})`
  )
}

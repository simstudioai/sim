import { createLogger } from '@sim/logger'
import type { RoomRef, RoomType } from '@sim/realtime-protocol/rooms'
import { getErrorMessage } from '@sim/utils/errors'
import type { AuthenticatedSocket } from '@/middleware/auth'

const logger = createLogger('RoomPermission')

/** Tells a socket, in its room type's own wire form, what a re-validated permission now allows. */
export type RoomPermissionPublisher = (
  socket: AuthenticatedSocket,
  room: RoomRef,
  permission: string | null
) => void

const publishers = new Map<RoomType, RoomPermissionPublisher>()

/**
 * Registers how a room type announces a re-validated permission. A registry for the same reason
 * as the eviction handlers: the access re-validation sweep stays domain-neutral, and the room's
 * handler keeps its own record of what each socket was last told.
 */
export function registerRoomPermissionPublisher(
  type: RoomType,
  publisher: RoomPermissionPublisher
): void {
  publishers.set(type, publisher)
}

/** Publishes a re-validated permission through the room type's publisher, if it has one. */
export function publishRoomPermission(
  socket: AuthenticatedSocket,
  room: RoomRef,
  permission: string | null
): void {
  const publisher = publishers.get(room.type)
  if (!publisher) return
  try {
    publisher(socket, room, permission)
  } catch (error) {
    logger.warn(`Room permission publish failed for socket ${socket.id} on ${room.type}`, {
      error: getErrorMessage(error),
    })
  }
}

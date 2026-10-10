import { createLogger } from '@sim/logger'
import { ROOM_MEMBERSHIP_ACTIONS, satisfiesRoomMembership } from '@sim/platform-authz/room-policy'
import {
  type InvalidationRoomType,
  invalidationRoomIdKey,
  type RoomRef,
  roomName,
} from '@sim/realtime-protocol/rooms'
import { toRecord } from '@sim/utils/object'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { resolveCurrentRoomPermission } from '@/middleware/permissions'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('WorkspaceInvalidationRoom')

/**
 * Wires an owner-scoped, presence-free "invalidation room" onto a socket: the client joins a
 * room named after its owner, and a `${roomType}-changed` event — fanned out by the server-side
 * mutation path over HTTP — reaches every viewer so they refetch. This is the shared core behind the
 * file and workspace resource browsers; their registered owner key preserves each wire payload.
 * The `roomType` derives
 * the event names: `join-${roomType}`,
 * `leave-${roomType}`, `join-${roomType}-success/-error`, and `${roomType}-changed`.
 *
 * These rooms carry NO presence — "who's in a resource" comes from the per-resource room (file-doc /
 * table), and mutations go over HTTP. Membership is tracked natively by Socket.IO (`socket.rooms`),
 * so multiple owners can subscribe independently without room-manager presence bookkeeping.
 */
export function setupWorkspaceInvalidationRoom(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager,
  roomType: InvalidationRoomType
) {
  const idKey = invalidationRoomIdKey(roomType)
  const joinEvent = `join-${roomType}`
  const leaveEvent = `leave-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const roomPrefix = `${roomType}:`
  const room = (ownerId: string): RoomRef => ({ type: roomType, id: ownerId })

  /** Unique tokens prevent an older attempt from surviving an owner leave/rejoin cycle. */
  const joinAttempts = new Map<string, symbol>()

  socket.on(joinEvent, async (payload: unknown) => {
    const ownerId = toRecord(payload)[idKey]
    /** Reject invalid requests before superseding an existing attempt for this owner. */
    if (!socket.userId || !socket.userName) {
      socket.emit(errorEvent, {
        [idKey]: ownerId,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false,
      })
      return
    }

    if (!roomManager.isReady()) {
      socket.emit(errorEvent, {
        [idKey]: ownerId,
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
      return
    }

    /** Validate owner identifiers before authorization. */
    if (
      typeof ownerId !== 'string' ||
      ownerId.length === 0 ||
      (idKey === 'projectId' &&
        (ownerId.length > 200 || ownerId !== ownerId.trim() || /[/:\s]/.test(ownerId)))
    ) {
      socket.emit(errorEvent, {
        [idKey]: typeof ownerId === 'string' ? ownerId : '',
        error: idKey === 'projectId' ? 'Invalid Project id' : 'Invalid workspace id',
        code: 'INVALID_PAYLOAD',
        retryable: false,
      })
      return
    }

    const joinAttempt = Symbol()
    joinAttempts.set(ownerId, joinAttempt)
    const isCurrentAttempt = () => joinAttempts.get(ownerId) === joinAttempt && !socket.disconnected
    try {
      const ref = room(ownerId)

      const authorized = await resolveRoomJoinAuth({
        userId: socket.userId,
        connectionId: socket.id,
        room: ref,
        action: ROOM_MEMBERSHIP_ACTIONS[roomType],
        logger,
        logLabel: `${roomType} room for ${socket.userId}`,
        messages: {
          verifyFailed:
            idKey === 'projectId'
              ? 'Failed to verify Project access'
              : 'Failed to verify workspace access',
          notFound: idKey === 'projectId' ? 'Project not found' : 'Workspace not found',
          accessDenied:
            idKey === 'projectId' ? 'Access denied to Project' : 'Access denied to workspace',
        },
        emitError: ({ error, code, retryable }) => {
          if (isCurrentAttempt()) {
            socket.emit(errorEvent, { [idKey]: ownerId, error, code, retryable })
          }
        },
      })
      if (!authorized || !isCurrentAttempt()) return

      /** Re-resolve access so revocation or an expired permission cache cannot admit a stale join. */
      const currentPermission = await resolveCurrentRoomPermission(
        socket.userId,
        ref,
        ROOM_MEMBERSHIP_ACTIONS[roomType],
        socket.id
      )
      if (!isCurrentAttempt()) return
      if (!satisfiesRoomMembership(currentPermission, roomType)) {
        socket.emit(errorEvent, {
          [idKey]: ownerId,
          error: idKey === 'projectId' ? 'Access denied to Project' : 'Access denied to workspace',
          code: 'ACCESS_DENIED',
          retryable: false,
        })
        return
      }

      socket.join(roomName(ref))
      socket.emit(successEvent, { [idKey]: ownerId })
    } catch (error) {
      if (!isCurrentAttempt()) return
      logger.error(`Error joining ${roomType} room:`, error)
      try {
        socket.leave(roomName(room(ownerId)))
      } catch {}
      socket.emit(errorEvent, {
        [idKey]: ownerId,
        error: `Failed to join ${roomType}`,
        code: 'JOIN_FAILED',
        retryable: true,
      })
    } finally {
      if (joinAttempts.get(ownerId) === joinAttempt) joinAttempts.delete(ownerId)
    }
  })

  socket.on('disconnect', () => joinAttempts.clear())

  socket.on(leaveEvent, (payload?: unknown) => {
    const ownerId = toRecord(payload)[idKey]
    if (ownerId !== undefined && (typeof ownerId !== 'string' || !ownerId)) return
    if (ownerId) joinAttempts.delete(ownerId)
    else joinAttempts.clear()
    const target = ownerId ? roomName(room(ownerId)) : null
    for (const joined of socket.rooms) {
      if (!joined.startsWith(roomPrefix)) continue
      if (target && joined !== target) continue
      socket.leave(joined)
    }
  })
}

import { createLogger } from '@sim/logger'
import { type RoomRef, type RoomType, roomName } from '@sim/realtime-protocol/rooms'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('WorkspaceInvalidationRoom')

interface JoinPayload {
  workspaceId: string
}

/**
 * Wires a workspace-scoped, presence-free "invalidation room" onto a socket: the client joins a
 * room named after its workspace, and a `${roomType}-changed` event — fanned out by the server-side
 * mutation path over HTTP — reaches every viewer so they refetch. This is the shared core behind the
 * workspace-files and workspace-tables browsers; they differ only in `roomType` (which also derives
 * the event names, since each room type's wire token IS its event stem: `join-${roomType}`,
 * `leave-${roomType}`, `join-${roomType}-success/-error`, and the `${roomType}-changed` broadcast).
 *
 * These rooms carry NO presence — "who's in a resource" comes from the per-resource room (file-doc /
 * table), and mutations go over HTTP. Membership is tracked natively by Socket.IO (`socket.rooms`),
 * so a workspace switch just leaves the prior room — no room-manager presence bookkeeping to sync.
 */
export function setupWorkspaceInvalidationRoom(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager,
  roomType: RoomType
) {
  const joinEvent = `join-${roomType}`
  const leaveEvent = `leave-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const roomPrefix = `${roomType}:`
  const room = (workspaceId: string): RoomRef => ({ type: roomType, id: workspaceId })

  // Monotonic per-socket join counter: each join captures its number and, after the async
  // authorize, aborts if a newer intent has superseded it — a fast workspace switch A→B can
  // otherwise let A's late completion leave B and strand the socket in A, missing B's
  // `${roomType}-changed` invalidations.
  let joinGeneration = 0
  // The workspace the socket currently intends to be in (set when a join starts). A leave that
  // targets this workspace — or an unscoped "leave all" — advances joinGeneration so an in-flight
  // join is cancelled instead of completing after the view has closed. A stale/deferred leave for
  // a DIFFERENT workspace must NOT advance it, or it would abort the join the client has since
  // switched to (the bug that bit the file-doc room in #5941).
  let currentWorkspace: string | null = null

  socket.on(joinEvent, async ({ workspaceId }: JoinPayload) => {
    // Validate synchronously BEFORE claiming a generation, so a rejected/malformed join can't
    // advance joinGeneration and cancel a legitimate in-flight join for another workspace.
    if (!socket.userId || !socket.userName) {
      socket.emit(errorEvent, {
        workspaceId,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false,
      })
      return
    }

    if (!roomManager.isReady()) {
      socket.emit(errorEvent, {
        workspaceId,
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
      return
    }

    // Validate the client-supplied id before it reaches the DB query (join payloads are
    // otherwise raw client input) and before advancing the generation.
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      socket.emit(errorEvent, {
        workspaceId: typeof workspaceId === 'string' ? workspaceId : '',
        error: 'Invalid workspace id',
        code: 'INVALID_PAYLOAD',
        retryable: false,
      })
      return
    }

    const joinAttempt = (joinGeneration += 1)
    currentWorkspace = workspaceId
    try {
      const ref = room(workspaceId)

      const authorized = await resolveRoomJoinAuth({
        userId: socket.userId,
        room: ref,
        action: 'read',
        logger,
        logLabel: `${roomType} room for ${socket.userId}`,
        messages: {
          verifyFailed: 'Failed to verify workspace access',
          notFound: 'Workspace not found',
          accessDenied: 'Access denied to workspace',
        },
        emitError: ({ error, code, retryable }) =>
          socket.emit(errorEvent, { workspaceId, error, code, retryable }),
      })
      if (!authorized) return

      // A newer join started on this socket during authorize (or it dropped): abort so a
      // stale join can't leave the room the client has since switched to.
      if (joinGeneration !== joinAttempt || socket.disconnected) return

      // Leave any previously-joined room of this type (workspace switch), read straight from the
      // socket's native room membership so there's no presence store to keep in sync.
      const target = roomName(ref)
      for (const joined of socket.rooms) {
        if (joined !== target && joined.startsWith(roomPrefix)) socket.leave(joined)
      }

      socket.join(target)
      socket.emit(successEvent, { workspaceId })
    } catch (error) {
      logger.error(`Error joining ${roomType} room:`, error)
      try {
        socket.leave(roomName(room(workspaceId)))
      } catch {}
      // Suppress the client-facing error when this join was already superseded: the client has
      // switched to a newer workspace, and a retryable error naming the abandoned one could make it
      // re-join and cancel the newer join. The leave above still runs.
      if (joinGeneration !== joinAttempt || socket.disconnected) return
      socket.emit(errorEvent, {
        workspaceId,
        error: `Failed to join ${roomType}`,
        code: 'JOIN_FAILED',
        retryable: true,
      })
    }
  })

  socket.on(leaveEvent, (payload?: { workspaceId?: string }) => {
    // Cancel an in-flight join whose target the client is now leaving: a join awaiting
    // authorization when the view unmounts would otherwise complete afterwards and strand the
    // socket in a room it has left. Only when the leave targets the current join intent (or is
    // unscoped) — a deferred leave for a different workspace must not abort the join the client
    // has since switched to.
    if (!payload?.workspaceId || payload.workspaceId === currentWorkspace) {
      joinGeneration += 1
      currentWorkspace = null
    }
    // Scope the leave to a specific workspace when the client provides one: a deferred leave
    // from a prior page must not evict a room the socket has since switched into.
    const target = payload?.workspaceId ? roomName(room(payload.workspaceId)) : null
    for (const joined of socket.rooms) {
      if (!joined.startsWith(roomPrefix)) continue
      if (target && joined !== target) continue
      socket.leave(joined)
    }
  })
}

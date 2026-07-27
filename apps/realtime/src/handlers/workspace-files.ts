import { createLogger } from '@sim/logger'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('WorkspaceFilesHandlers')

/** The workspace-files room ref for a workspace id. */
const filesRoom = (workspaceId: string): RoomRef => ({
  type: ROOM_TYPES.WORKSPACE_FILES,
  id: workspaceId,
})

/** Socket.IO room-name prefix shared by every workspace-files room. */
const FILES_ROOM_PREFIX = `${ROOM_TYPES.WORKSPACE_FILES}:`

interface JoinPayload {
  workspaceId: string
}

/**
 * Keeps the workspace file browser live. The socket joins a workspace-scoped Socket.IO room
 * so a `workspace-files-changed` event — fanned out by the HTTP mutation API — reaches every
 * viewer, who then refetches. This room carries NO presence: "who's in a file" comes from
 * the per-file doc room, and file mutations go over HTTP. Membership is tracked natively by
 * Socket.IO (`socket.rooms`), so a workspace switch just leaves the prior files room — no
 * room-manager presence bookkeeping to keep in sync.
 */
export function setupWorkspaceFilesHandlers(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager
) {
  // Monotonic per-socket join counter: each join captures its number and, after the async
  // authorize, aborts if a newer intent has superseded it — a fast workspace switch A→B can
  // otherwise let A's late completion leave B and strand the socket in A, missing B's
  // `workspace-files-changed` invalidations.
  let joinGeneration = 0
  // The workspace the socket currently intends to be in (set when a join starts). A leave that
  // targets this workspace — or an unscoped "leave all" — advances joinGeneration so an in-flight
  // join is cancelled instead of completing after the view has closed. A stale/deferred leave for
  // a DIFFERENT workspace must NOT advance it, or it would abort the join the client has since
  // switched to (the bug that bit the file-doc room in #5941).
  let currentWorkspace: string | null = null

  socket.on('join-workspace-files', async ({ workspaceId }: JoinPayload) => {
    const joinAttempt = (joinGeneration += 1)
    currentWorkspace = workspaceId
    try {
      if (!socket.userId || !socket.userName) {
        socket.emit('join-workspace-files-error', {
          workspaceId,
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
          retryable: false,
        })
        return
      }

      if (!roomManager.isReady()) {
        socket.emit('join-workspace-files-error', {
          workspaceId,
          error: 'Realtime unavailable',
          code: 'ROOM_MANAGER_UNAVAILABLE',
          retryable: true,
        })
        return
      }

      // Validate the client-supplied id before it reaches the DB query (join payloads are
      // otherwise raw client input).
      if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
        socket.emit('join-workspace-files-error', {
          workspaceId: typeof workspaceId === 'string' ? workspaceId : '',
          error: 'Invalid workspace id',
          code: 'INVALID_PAYLOAD',
          retryable: false,
        })
        return
      }

      const room = filesRoom(workspaceId)

      const authorized = await resolveRoomJoinAuth({
        userId: socket.userId,
        room,
        action: 'read',
        logger,
        logLabel: `files room for ${socket.userId}`,
        messages: {
          verifyFailed: 'Failed to verify workspace access',
          notFound: 'Workspace not found',
          accessDenied: 'Access denied to workspace',
        },
        emitError: ({ error, code, retryable }) =>
          socket.emit('join-workspace-files-error', { workspaceId, error, code, retryable }),
      })
      if (!authorized) return

      // A newer join started on this socket during authorize (or it dropped): abort so a
      // stale join can't leave the room the client has since switched to.
      if (joinGeneration !== joinAttempt || socket.disconnected) return

      // Leave any previously-joined files room (workspace switch), read straight from the
      // socket's native room membership so there's no presence store to keep in sync.
      const target = roomName(room)
      for (const joined of socket.rooms) {
        if (joined !== target && joined.startsWith(FILES_ROOM_PREFIX)) socket.leave(joined)
      }

      socket.join(target)
      socket.emit('join-workspace-files-success', { workspaceId })
    } catch (error) {
      logger.error('Error joining workspace files room:', error)
      try {
        socket.leave(roomName(filesRoom(workspaceId)))
      } catch {}
      socket.emit('join-workspace-files-error', {
        workspaceId,
        error: 'Failed to join workspace files',
        code: 'JOIN_FAILED',
        retryable: true,
      })
    }
  })

  socket.on('leave-workspace-files', (payload?: { workspaceId?: string }) => {
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
    // from a prior page must not evict a files room the socket has since switched into.
    const target = payload?.workspaceId ? roomName(filesRoom(payload.workspaceId)) : null
    for (const joined of socket.rooms) {
      if (!joined.startsWith(FILES_ROOM_PREFIX)) continue
      if (target && joined !== target) continue
      socket.leave(joined)
    }
  })
}

import { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
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
  socket.on('join-workspace-files', async ({ workspaceId }: JoinPayload) => {
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

      let authorized: Awaited<ReturnType<typeof authorizeRoom>>
      try {
        authorized = await authorizeRoom({ userId: socket.userId, room, action: 'read' })
      } catch (error) {
        logger.warn(`Error authorizing files room for ${socket.userId}:`, error)
        socket.emit('join-workspace-files-error', {
          workspaceId,
          error: 'Failed to verify workspace access',
          code: 'VERIFY_ACCESS_FAILED',
          retryable: true,
        })
        return
      }

      if (!authorized.allowed) {
        socket.emit('join-workspace-files-error', {
          workspaceId,
          error: authorized.status === 404 ? 'Workspace not found' : 'Access denied to workspace',
          code: authorized.status === 404 ? 'NOT_FOUND' : 'ACCESS_DENIED',
          retryable: false,
        })
        return
      }

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

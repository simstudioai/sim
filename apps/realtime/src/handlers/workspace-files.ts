import { db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { eq } from 'drizzle-orm'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager, UserPresence } from '@/rooms'
import { filterVisiblePresence, sweepStalePresence } from '@/rooms/presence-visibility'

const logger = createLogger('WorkspaceFilesHandlers')

/** The workspace-files room ref for a workspace id. */
const filesRoom = (workspaceId: string): RoomRef => ({
  type: ROOM_TYPES.WORKSPACE_FILES,
  id: workspaceId,
})

interface JoinPayload {
  workspaceId: string
  folderId?: string | null
  tabSessionId?: string
}

async function resolveAvatarUrl(
  socket: AuthenticatedSocket,
  userId: string
): Promise<string | null> {
  if (socket.userImage) return socket.userImage
  try {
    const [record] = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return record?.image ?? null
  } catch (error) {
    logger.warn('Failed to load user avatar for files presence', { userId, error })
    return null
  }
}

/**
 * Presence handlers for the workspace file browser. Mirrors the workflow join
 * flow but is workspace-scoped (room id = workspaceId) and read-only presence:
 * there are no persisted file operations over the socket — file mutations go
 * through the HTTP API, which fans out a `workspace-files-changed` event
 * separately. The viewer's `folderId` is recorded at join (a future hook for
 * folder-scoped presence); there is no cursor channel here yet.
 */
export function setupWorkspaceFilesHandlers(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager
) {
  socket.on(
    'join-workspace-files',
    async ({ workspaceId, folderId, tabSessionId }: JoinPayload) => {
      try {
        const userId = socket.userId
        const userName = socket.userName

        if (!userId || !userName) {
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

        // Validate the client-supplied id before it reaches the DB query (matches
        // the /api/workspace-files-changed guard; join payloads are otherwise raw
        // client input).
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
          authorized = await authorizeRoom({ userId, room, action: 'read' })
        } catch (error) {
          logger.warn(`Error authorizing files room for ${userId}:`, error)
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

        // Leave a previously-joined files room if switching workspaces.
        const currentRoom = await roomManager.getRoomForSocket(
          socket.id,
          ROOM_TYPES.WORKSPACE_FILES
        )
        if (currentRoom && currentRoom.id !== workspaceId) {
          socket.leave(roomName(currentRoom))
          await roomManager.removeUserFromRoom(currentRoom, socket.id)
          await roomManager.broadcastPresenceUpdate(currentRoom)
        }

        // Clean up the same user's stale socket from the same tab (e.g. a reconnect
        // that raced the old socket's disconnect), so presence shows one entry.
        if (tabSessionId) {
          const existingUsers = await roomManager.getRoomUsers(room)
          for (const existing of existingUsers) {
            if (
              existing.socketId !== socket.id &&
              existing.userId === userId &&
              existing.tabSessionId === tabSessionId
            ) {
              await roomManager.removeUserFromRoom(room, existing.socketId)
              await roomManager.io.in(existing.socketId).socketsLeave(roomName(room))
            }
          }
        }

        // Reclaim any presence orphaned by an ungraceful disconnect (pod crash
        // fires no `disconnecting` event; the room hashes have no TTL).
        await sweepStalePresence(roomManager, room)

        socket.join(roomName(room))

        const presence: UserPresence = {
          userId,
          room,
          userName,
          socketId: socket.id,
          tabSessionId,
          joinedAt: Date.now(),
          lastActivity: Date.now(),
          role: authorized.workspacePermission ?? 'read',
          folderId: folderId ?? null,
          avatarUrl: await resolveAvatarUrl(socket, userId),
        }

        await roomManager.addUserToRoom(room, socket.id, presence)

        // Filter the join ack to live members so a new joiner never briefly sees a
        // ghost from an entry the sweep hasn't reclaimed yet.
        const presenceUsers = await filterVisiblePresence(
          roomManager.io,
          room,
          await roomManager.getRoomUsers(room)
        )
        socket.emit('join-workspace-files-success', {
          workspaceId,
          socketId: socket.id,
          presenceUsers,
        })

        await roomManager.broadcastPresenceUpdate(room)

        logger.info(`User ${userId} (${userName}) joined files room for workspace ${workspaceId}`)
      } catch (error) {
        logger.error('Error joining workspace files room:', error)
        // Roll back any partial join so a failed attempt can't leave the socket in
        // the Socket.IO room or a stale presence entry behind (mirrors the workflow
        // join's rollback), before signalling a retryable failure.
        try {
          const room = filesRoom(workspaceId)
          socket.leave(roomName(room))
          await roomManager.removeUserFromRoom(room, socket.id)
        } catch {}
        socket.emit('join-workspace-files-error', {
          workspaceId,
          error: 'Failed to join workspace files',
          code: 'JOIN_FAILED',
          retryable: true,
        })
      }
    }
  )

  socket.on('files-cursor-update', async ({ cursor, folderId }) => {
    try {
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKSPACE_FILES)
      const session = await roomManager.getUserSession(socket.id)
      if (!room || !session) return

      await roomManager.updateUserActivity(room, socket.id, { cursor })

      // Broadcast to the room; the client scopes rendering to the same folder via
      // the `folderId` carried on the payload.
      socket.to(roomName(room)).emit('files-cursor-update', {
        socketId: socket.id,
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl,
        cursor,
        folderId: folderId ?? null,
      })
    } catch (error) {
      logger.error(`Error handling files cursor update for socket ${socket.id}:`, error)
    }
  })

  socket.on('leave-workspace-files', async (payload?: { workspaceId?: string }) => {
    try {
      if (!roomManager.isReady()) return
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKSPACE_FILES)
      if (!room) return
      // Scope the leave to a specific workspace when the client provides one: a
      // deferred leave from a prior page must not evict the socket from a room it
      // has since switched into (workspace A→B leaves A's leave targeting B).
      if (payload?.workspaceId && payload.workspaceId !== room.id) return
      socket.leave(roomName(room))
      await roomManager.removeUserFromRoom(room, socket.id)
      await roomManager.broadcastPresenceUpdate(room, socket.id)
    } catch (error) {
      logger.error('Error leaving workspace files room:', error)
    }
  })
}

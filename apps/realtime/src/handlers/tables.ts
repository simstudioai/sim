import { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import {
  type JoinTablePayload,
  TABLE_PRESENCE_EVENTS,
  type TableCellRef,
  type TableCellSelection,
} from '@sim/realtime-protocol/table-presence'
import { resolveAvatarUrl } from '@/handlers/avatar'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager, UserPresence } from '@/rooms'
import { filterVisiblePresence, sweepStalePresence } from '@/rooms/presence-visibility'

const logger = createLogger('TablePresenceHandlers')

/** Longest accepted row/column id — real ids are UUIDs/short ids; this bounds a hostile payload. */
const MAX_CELL_ID_LENGTH = 200

/** The table presence room ref for a table id. */
const tableRoom = (tableId: string): RoomRef => ({ type: ROOM_TYPES.TABLE, id: tableId })

function isCellRef(value: unknown): value is TableCellRef {
  const ref = value as TableCellRef | null
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof ref.rowId === 'string' &&
    ref.rowId.length <= MAX_CELL_ID_LENGTH &&
    typeof ref.columnId === 'string' &&
    ref.columnId.length <= MAX_CELL_ID_LENGTH
  )
}

/**
 * Validate + whitelist an untrusted peer's selection before it is stored and
 * rebroadcast (it ultimately flows into a DOM query on every viewer). Returns the
 * normalized selection — `null` for a legitimately cleared selection — or `undefined`
 * for anything malformed, so the caller drops it. Only the known fields survive, so a
 * hostile client can't amplify an oversized object through the room.
 */
function normalizeCellSelection(cell: unknown): TableCellSelection | undefined {
  if (cell === null) return null
  if (typeof cell !== 'object') return undefined
  const candidate = cell as { anchor?: unknown; focus?: unknown; editing?: unknown }
  if (!isCellRef(candidate.anchor) || !isCellRef(candidate.focus)) return undefined
  return {
    anchor: { rowId: candidate.anchor.rowId, columnId: candidate.anchor.columnId },
    focus: { rowId: candidate.focus.rowId, columnId: candidate.focus.columnId },
    ...(candidate.editing === true ? { editing: true } : {}),
  }
}

/**
 * Live cell-selection presence for the table grid. Mirrors the workspace-files
 * join flow but is table-scoped (room id = tableId) with a bidirectional
 * cell-selection channel — the grid analog of the workflow cursor/selection
 * relay. Table *data* still flows through the one-way durable event stream
 * (`lib/table/events.ts`); this socket carries only ephemeral presence.
 *
 * Table rooms are namespaced (`table:${id}`), so every broadcast targets
 * `roomName(room)`, never the bare `room.id` (which the workflow handler can use
 * only because a workflow room's name equals its id).
 */
export function setupTablesHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on(TABLE_PRESENCE_EVENTS.JOIN, async ({ tableId, tabSessionId }: JoinTablePayload) => {
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
          tableId,
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
          retryable: false,
        })
        return
      }

      if (!roomManager.isReady()) {
        socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
          tableId,
          error: 'Realtime unavailable',
          code: 'ROOM_MANAGER_UNAVAILABLE',
          retryable: true,
        })
        return
      }

      // Validate the client-supplied id before it reaches the DB query.
      if (typeof tableId !== 'string' || tableId.length === 0) {
        socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
          tableId: typeof tableId === 'string' ? tableId : '',
          error: 'Invalid table id',
          code: 'INVALID_PAYLOAD',
          retryable: false,
        })
        return
      }

      const room = tableRoom(tableId)

      let authorized: Awaited<ReturnType<typeof authorizeRoom>>
      try {
        authorized = await authorizeRoom({ userId, room, action: 'read' })
      } catch (error) {
        logger.warn(`Error authorizing table room for ${userId}:`, error)
        socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
          tableId,
          error: 'Failed to verify table access',
          code: 'VERIFY_ACCESS_FAILED',
          retryable: true,
        })
        return
      }

      if (!authorized.allowed) {
        socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
          tableId,
          error: authorized.status === 404 ? 'Table not found' : 'Access denied to table',
          code: authorized.status === 404 ? 'NOT_FOUND' : 'ACCESS_DENIED',
          retryable: false,
        })
        return
      }

      // Leave a previously-joined table room if switching tables.
      const currentRoom = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
      if (currentRoom && currentRoom.id !== tableId) {
        socket.leave(roomName(currentRoom))
        await roomManager.removeUserFromRoom(currentRoom, socket.id)
        await roomManager.broadcastPresenceUpdate(currentRoom)
      }

      // Clean up the same user's stale socket from the same tab (a reconnect that
      // raced the old socket's disconnect), so presence shows one entry.
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

      // Reclaim presence orphaned by an ungraceful disconnect (no `disconnecting`
      // event fires on a pod crash; the room hashes have no TTL).
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
      socket.emit(TABLE_PRESENCE_EVENTS.JOIN_SUCCESS, {
        tableId,
        socketId: socket.id,
        presenceUsers,
      })

      await roomManager.broadcastPresenceUpdate(room)

      logger.info(`User ${userId} (${userName}) joined table room ${tableId}`)
    } catch (error) {
      logger.error('Error joining table room:', error)
      // Roll back any partial join so a failed attempt can't leave the socket in the
      // Socket.IO room or a stale presence entry behind, before signalling a retry.
      try {
        const room = tableRoom(tableId)
        socket.leave(roomName(room))
        await roomManager.removeUserFromRoom(room, socket.id)
      } catch {}
      socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
        tableId,
        error: 'Failed to join table',
        code: 'JOIN_FAILED',
        retryable: true,
      })
    }
  })

  socket.on(TABLE_PRESENCE_EVENTS.LEAVE, async (payload?: { tableId?: string }) => {
    try {
      if (!roomManager.isReady()) return
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
      if (!room) return
      // Scope the leave to a specific table when the client provides one: a deferred
      // leave from a prior view must not evict the socket from a room it has since
      // switched into (table A→B leaves A's leave targeting B).
      if (payload?.tableId && payload.tableId !== room.id) return
      socket.leave(roomName(room))
      await roomManager.removeUserFromRoom(room, socket.id)
      await roomManager.broadcastPresenceUpdate(room, socket.id)
    } catch (error) {
      logger.error('Error leaving table room:', error)
    }
  })

  socket.on(TABLE_PRESENCE_EVENTS.CELL_SELECTION, async ({ cell }: { cell: unknown }) => {
    try {
      // Drop a malformed/oversized selection from an untrusted peer before it is stored
      // or rebroadcast (`undefined` = invalid; `null` = a legitimately cleared selection).
      const selection = normalizeCellSelection(cell)
      if (selection === undefined) return

      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
      if (!room) return

      // Persist so a later joiner sees this viewer's current selection in the join ack.
      await roomManager.updateUserActivity(room, socket.id, { cell: selection })

      // Relay to peers (namespaced room → roomName, not room.id). Peers already know this
      // socket's identity from the presence roster, so the delta carries only id + cell.
      socket.to(roomName(room)).emit(TABLE_PRESENCE_EVENTS.CELL_SELECTION, {
        socketId: socket.id,
        cell: selection,
      })
    } catch (error) {
      logger.error(`Error handling table cell selection for socket ${socket.id}:`, error)
    }
  })
}

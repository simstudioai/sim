import { createLogger } from '@sim/logger'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import {
  type JoinTablePayload,
  TABLE_PRESENCE_EVENTS,
  type TableCellRef,
  type TableCellSelection,
} from '@sim/realtime-protocol/table-presence'
import { resolveAvatarUrl } from '@/handlers/avatar'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager, UserPresence } from '@/rooms'
import { filterVisiblePresence, sweepStalePresence } from '@/rooms/presence-visibility'

const logger = createLogger('TablePresenceHandlers')

/** Longest accepted row/column id — real ids are UUIDs/short ids; this bounds a hostile payload. */
const MAX_CELL_ID_LENGTH = 200

/** The table presence room ref for a table id. */
const tableRoom = (tableId: string): RoomRef => ({ type: ROOM_TYPES.TABLE, id: tableId })

function isCellRef(value: unknown): value is TableCellRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as { rowId?: unknown; columnId?: unknown }
  return (
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
  // Monotonic per-socket join counter: each JOIN captures its number and, after the async
  // authorize, aborts if a newer JOIN has started — a fast table switch A→B can otherwise
  // let A's late handler leave B and strand the socket in room A while the client views B.
  let joinGeneration = 0
  // The table the socket currently intends to be in (set when a join starts). A leave
  // targeting it — or an unscoped leave — advances joinGeneration to cancel an in-flight
  // join, so a join still awaiting authorization can't complete after the client left and
  // strand the socket in the room (present in presence + still receiving broadcasts). A
  // leave for a DIFFERENT table must NOT cancel it (a table switch), mirroring workspace-files.
  let currentTableId: string | null = null

  socket.on(TABLE_PRESENCE_EVENTS.JOIN, async ({ tableId, tabSessionId }: JoinTablePayload) => {
    const joinAttempt = (joinGeneration += 1)
    currentTableId = tableId
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

      const authorized = await resolveRoomJoinAuth({
        userId,
        room,
        action: 'read',
        logger,
        logLabel: `table room for ${userId}`,
        messages: {
          verifyFailed: 'Failed to verify table access',
          notFound: 'Table not found',
          accessDenied: 'Access denied to table',
        },
        emitError: ({ error, code, retryable }) =>
          socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, { tableId, error, code, retryable }),
      })
      if (!authorized) return

      // A newer JOIN started on this socket during authorize (or the socket dropped):
      // abort so a stale join can't leave the room the client has since moved to.
      // Server-authenticated avatar for the presence roster. Resolved up-front so the guard
      // below also covers this await (mirrors the file-doc join).
      const avatarUrl = await resolveAvatarUrl(socket, userId)

      // Abort a JOIN superseded during authorize/avatar resolution — a newer JOIN (table
      // switch), a LEAVE, or a disconnect. Registering below would strand the socket.
      if (joinGeneration !== joinAttempt || socket.disconnected) return

      // Leave a previously-joined table room if switching tables. Re-check the generation
      // after the lookup await: if a newer join committed to a room during it, `currentRoom`
      // is now that room, and leaving it here would tear down the join the client actually
      // holds. A superseded join must abort before this mutation.
      const currentRoom = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
      if (joinGeneration !== joinAttempt || socket.disconnected) return
      if (currentRoom && currentRoom.id !== tableId) {
        socket.leave(roomName(currentRoom))
        await roomManager.removeUserFromRoom(currentRoom, socket.id)
        await roomManager.broadcastPresenceUpdate(currentRoom)
      }

      // Reclaim presence orphaned by an ungraceful disconnect (no `disconnecting`
      // event fires on a pod crash; the room hashes have no TTL). Returns the roster it
      // read so the same-tab dedup below reuses it instead of issuing a second read.
      const roster = await sweepStalePresence(roomManager, room)

      // Clean up the same user's stale socket from the same tab (a reconnect that raced
      // the old socket's disconnect), so presence shows one entry. Reuses the sweep's
      // roster snapshot; re-removing an already-swept entry is a harmless no-op.
      if (tabSessionId) {
        for (const existing of roster) {
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

      // Final re-check immediately before the membership commit: a newer JOIN (table switch), a
      // LEAVE, or a disconnect during the leave/sweep awaits above must abort here — otherwise
      // this superseded join would join the room and register presence, stranding the socket in
      // the wrong table. No await sits between this guard and addUserToRoom (the commit).
      if (joinGeneration !== joinAttempt || socket.disconnected) return

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
        avatarUrl,
      }

      await roomManager.addUserToRoom(room, socket.id, presence)

      // A newer join (table switch) or a leave may have committed while addUserToRoom was in
      // flight — that newer join's own leave-prior can't reliably observe this half-written
      // entry, so undo our registration here rather than strand the socket on the wrong table.
      // Scoped to THIS room (`room`), so `removeUserFromRoom` only clears our socket→room map
      // when it still points here and never touches the newer join's room.
      if (joinGeneration !== joinAttempt || socket.disconnected) {
        socket.leave(roomName(room))
        await roomManager.removeUserFromRoom(room, socket.id)
        return
      }

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
      // A superseded join (a newer join/leave bumped the generation) must NOT roll back — it
      // would tear down room state a newer successful join to the same table now holds — nor
      // signal an error for a table the client already left.
      if (joinGeneration !== joinAttempt) return
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
      // Cancel an in-flight join whose table the client is now leaving (or an unscoped
      // leave): a join still awaiting authorization would otherwise complete after the
      // client left — joining the room, registering presence, and broadcasting a ghost
      // until disconnect. Guard on the current table intent so a stale/deferred leave for
      // a DIFFERENT table can't abort the join the client has since switched to. Runs
      // before the teardown below because the racing join has registered nothing yet
      // (getRoomForSocket returns null), so only this generation bump can stop it.
      if (!payload?.tableId || payload.tableId === currentTableId) {
        joinGeneration += 1
        currentTableId = null
      }
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

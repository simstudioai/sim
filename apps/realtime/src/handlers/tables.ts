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
  // Monotonic per-socket generation: each JOIN/LEAVE bumps it synchronously on arrival, and a
  // queued or in-flight op that finds a newer generation aborts — a fast table switch A→B thus
  // cancels A the instant B arrives.
  let joinGeneration = 0
  // The table the socket currently intends to be in (set when a join is enqueued). A leave
  // targeting it — or an unscoped leave — bumps the generation to cancel that join; a leave for a
  // DIFFERENT table must NOT (a table switch), mirroring workspace-files.
  let currentTableId: string | null = null
  // Serialize this socket's room mutations (JOIN + LEAVE) so their multi-step async Redis commits
  // can never interleave: two concurrent joins would otherwise race on the single-valued
  // socket→room map (a late addUserToRoom clobbering a newer join's entry). This restores the
  // atomic-commit property the synchronous sibling handlers (file-doc, workspace-files) get for
  // free. CELL_SELECTION is NOT chained — it only touches presence activity, never the map.
  let opChain: Promise<void> = Promise.resolve()

  socket.on(TABLE_PRESENCE_EVENTS.JOIN, ({ tableId, tabSessionId }: JoinTablePayload) => {
    const joinAttempt = (joinGeneration += 1)
    currentTableId = tableId
    opChain = opChain
      .then(() => runJoin(tableId, tabSessionId, joinAttempt))
      .catch((error) => logger.error('Error joining table room:', error))
    // Returned so callers awaiting this op (e.g. tests) can await its completion; Socket.IO
    // ignores a handler's return value.
    return opChain
  })

  async function runJoin(tableId: string, tabSessionId: string | undefined, joinAttempt: number) {
    // True once this JOIN has been superseded — a newer JOIN/LEAVE bumped joinGeneration, or the
    // socket disconnected. Because ops are serialized, no other op mutates room state while this
    // one runs, so only two checks are needed: skip a superseded queued op (here), and one final
    // check right before the membership commit.
    const superseded = () => joinGeneration !== joinAttempt || socket.disconnected
    if (superseded()) return
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

      // Server-authenticated avatar for the presence roster.
      const avatarUrl = await resolveAvatarUrl(socket, userId)

      // Leave a previously-joined table room if switching tables. No generation guard is needed
      // around this: serialization guarantees no concurrent op committed to a different room
      // during the lookup, so `currentRoom` is the socket's genuine prior room, safe to leave.
      const currentRoom = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
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

      // Final re-check before the membership commit: a LEAVE or a newer JOIN enqueued during the
      // awaits above bumped the generation, or the socket disconnected. Abort before registering.
      if (superseded()) return

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

      // If the socket disconnects during this commit (disconnect cleanup runs off the op chain),
      // this write can land after it, leaving a stale presence entry. Benign and self-correcting:
      // filterVisiblePresence hides it and sweepStalePresence reclaims it (same as the siblings).
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
      // Always roll back a partial join: cleanup keys off the socket→room map, so a `socket.join`
      // that landed without a matching `addUserToRoom` (a throw in between) would otherwise leave
      // the socket stranded in the Socket.IO room, unreclaimable by any later op. Safe to run even
      // when superseded — serialization means the newer op hasn't committed yet, so this touches
      // only this join's own (this-table) state, never the newer op's room.
      try {
        const room = tableRoom(tableId)
        socket.leave(roomName(room))
        await roomManager.removeUserFromRoom(room, socket.id)
      } catch {
        // Best-effort rollback — the original join failure is the one surfaced below, so a
        // secondary cleanup error must not mask it or throw out of the error handler.
      }
      socket.emit(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
        tableId,
        error: 'Failed to join table',
        code: 'JOIN_FAILED',
        retryable: true,
      })
    }
  }

  socket.on(TABLE_PRESENCE_EVENTS.LEAVE, (payload?: { tableId?: string }) => {
    // Cancel an in-flight/queued join whose table the client is now leaving (or an unscoped
    // leave). Scope to the current table intent so a stale/deferred leave for a DIFFERENT table
    // can't cancel the join the client has since switched to. Bumped synchronously here — before
    // the teardown is enqueued — so it cancels a running join at its next generation check.
    if (!payload?.tableId || payload.tableId === currentTableId) {
      joinGeneration += 1
      currentTableId = null
    }
    opChain = opChain
      .then(() => runLeave(payload))
      .catch((error) => logger.error('Error leaving table room:', error))
    return opChain
  })

  async function runLeave(payload?: { tableId?: string }) {
    try {
      if (!roomManager.isReady()) return
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.TABLE)
      if (!room) return
      // Scope the leave to a specific table when the client provides one: a deferred leave from a
      // prior view must not evict the socket from a room it has since switched into.
      if (payload?.tableId && payload.tableId !== room.id) return
      socket.leave(roomName(room))
      await roomManager.removeUserFromRoom(room, socket.id)
      await roomManager.broadcastPresenceUpdate(room, socket.id)
    } catch (error) {
      logger.error('Error leaving table room:', error)
    }
  }

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

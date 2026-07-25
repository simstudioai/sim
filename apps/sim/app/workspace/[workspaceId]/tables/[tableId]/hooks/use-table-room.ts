'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { presenceEventName, ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import {
  type JoinTableError,
  type JoinTableSuccess,
  TABLE_PRESENCE_EVENTS,
  type TableCellSelection,
  type TableCellSelectionBroadcast,
  type TablePresenceUser,
} from '@sim/realtime-protocol/table-presence'
import { generateShortId } from '@sim/utils/id'
import type { PresenceAvatarUser } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { useSocket } from '@/app/workspace/providers/socket-provider'

const logger = createLogger('TableRoom')

/** Retry cap + base delay for a retryable join failure on an otherwise-live socket. */
const MAX_JOIN_RETRIES = 3
const JOIN_RETRY_BASE_MS = 1000
/** Trailing-throttle window for broadcasting local selection changes (smooths drag-select). */
const SELECTION_EMIT_THROTTLE_MS = 50

/** The `table:presence-update` broadcast name, derived from the room type. */
const TABLE_PRESENCE_UPDATE_EVENT = presenceEventName(ROOM_TYPES.TABLE)

/** A remote viewer's current cell selection, ready to render as a presence overlay. */
export interface RemoteTableSelection {
  socketId: string
  userId: string
  userName: string
  cell: NonNullable<TableCellSelection>
}

interface UseTableRoomResult {
  /** Collaborators viewing this table, excluding the current socket (for avatars). */
  otherUsers: PresenceAvatarUser[]
  /** Remote viewers that currently have a cell selected (for overlays). */
  remoteSelections: RemoteTableSelection[]
  /** Broadcast the local viewer's current cell selection (`null` clears it). Throttled. */
  emitCellSelection: (cell: TableCellSelection) => void
}

/**
 * Joins the table presence room for live collaborator avatars + cell-selection
 * highlights. Presence rides the shared socket (`useSocket`); table data is
 * unchanged (it flows through the one-way durable event stream). The full roster
 * arrives via the presence broadcast (join/leave); individual selection moves
 * arrive as lower-latency {@link TABLE_PRESENCE_EVENTS.CELL_SELECTION} deltas that
 * patch the matching roster entry.
 */
export function useTableRoom(tableId: string): UseTableRoomResult {
  const { socket, currentSocketId } = useSocket()

  const [presenceUsers, setPresenceUsers] = useState<TablePresenceUser[]>([])

  const tabSessionIdRef = useRef<string>('')
  if (!tabSessionIdRef.current) tabSessionIdRef.current = generateShortId()

  useEffect(() => {
    if (!socket || !tableId) return

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const join = () => {
      socket.emit(TABLE_PRESENCE_EVENTS.JOIN, { tableId, tabSessionId: tabSessionIdRef.current })
    }

    const handleJoinSuccess = (data: JoinTableSuccess) => {
      if (data.tableId !== tableId) return
      retries = 0
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      setPresenceUsers(data.presenceUsers ?? [])
    }
    const handleJoinError = (data: JoinTableError) => {
      if (data.tableId !== tableId) return
      logger.warn('Failed to join table room', { code: data.code, error: data.error })
      if (data.retryable && retries < MAX_JOIN_RETRIES) {
        retries += 1
        retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
      }
    }
    const handlePresence = (users: TablePresenceUser[]) => {
      // Take membership from the roster snapshot but keep the `cell` we already hold for
      // a known socket: the snapshot can be a beat behind the lower-latency CELL_SELECTION
      // deltas, so a blind replace could revert a fresher selection (it self-heals on the
      // peer's next delta, but the revert flicker is avoidable).
      setPresenceUsers((prev) => {
        const cellBySocket = new Map(prev.map((user) => [user.socketId, user.cell]))
        return (users ?? []).map((user) =>
          cellBySocket.has(user.socketId)
            ? { ...user, cell: cellBySocket.get(user.socketId) }
            : user
        )
      })
    }
    const handleCellSelection = (data: TableCellSelectionBroadcast) => {
      // Patch the matching roster entry's selection. The peer is always already in
      // the roster: the server broadcasts their join (→ presence-update) before they
      // can select, and Socket.IO preserves that order — so a delta for an unknown
      // socket only means a dropped broadcast, which the next presence-update heals.
      setPresenceUsers((prev) =>
        prev.map((user) => (user.socketId === data.socketId ? { ...user, cell: data.cell } : user))
      )
    }

    // Join now if the socket is already connected; `connect` covers (re)connects.
    if (socket.connected) join()
    socket.on('connect', join)
    socket.on(TABLE_PRESENCE_EVENTS.JOIN_SUCCESS, handleJoinSuccess)
    socket.on(TABLE_PRESENCE_EVENTS.JOIN_ERROR, handleJoinError)
    socket.on(TABLE_PRESENCE_UPDATE_EVENT, handlePresence)
    socket.on(TABLE_PRESENCE_EVENTS.CELL_SELECTION, handleCellSelection)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.off('connect', join)
      socket.off(TABLE_PRESENCE_EVENTS.JOIN_SUCCESS, handleJoinSuccess)
      socket.off(TABLE_PRESENCE_EVENTS.JOIN_ERROR, handleJoinError)
      socket.off(TABLE_PRESENCE_UPDATE_EVENT, handlePresence)
      socket.off(TABLE_PRESENCE_EVENTS.CELL_SELECTION, handleCellSelection)
      setPresenceUsers([])
      // Leave scoped to THIS table so a table A→B switch (B joins first, auto-leaving
      // A) can't have A's deferred leave evict the fresh B membership.
      socket.emit(TABLE_PRESENCE_EVENTS.LEAVE, { tableId })
    }
  }, [socket, tableId])

  const socketRef = useRef(socket)
  socketRef.current = socket
  const lastEmitRef = useRef(0)
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCellRef = useRef<TableCellSelection>(null)

  // Reset the throttle when the table changes (or on unmount): a pending selection for
  // the table we're leaving must not flush into the next table's room after a switch.
  useEffect(
    () => () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current)
        trailingTimerRef.current = null
      }
      pendingCellRef.current = null
      lastEmitRef.current = 0
    },
    [tableId]
  )

  const emitCellSelection = useCallback((cell: TableCellSelection) => {
    pendingCellRef.current = cell
    const flush = () => {
      lastEmitRef.current = Date.now()
      trailingTimerRef.current = null
      socketRef.current?.emit(TABLE_PRESENCE_EVENTS.CELL_SELECTION, {
        cell: pendingCellRef.current,
      })
    }
    const elapsed = Date.now() - lastEmitRef.current
    if (elapsed >= SELECTION_EMIT_THROTTLE_MS) {
      flush()
    } else if (!trailingTimerRef.current) {
      trailingTimerRef.current = setTimeout(flush, SELECTION_EMIT_THROTTLE_MS - elapsed)
    }
  }, [])

  const otherUsers = useMemo(
    () => presenceUsers.filter((user) => user.socketId !== currentSocketId),
    [presenceUsers, currentSocketId]
  )
  const remoteSelections = useMemo<RemoteTableSelection[]>(
    () =>
      otherUsers
        .filter(
          (user): user is TablePresenceUser & { cell: NonNullable<TableCellSelection> } =>
            user.cell != null
        )
        .map((user) => ({
          socketId: user.socketId,
          userId: user.userId,
          userName: user.userName,
          cell: user.cell,
        })),
    [otherUsers]
  )

  return { otherUsers, remoteSelections, emitCellSelection }
}

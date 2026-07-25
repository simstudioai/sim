/**
 * Wire protocol for live table presence — which cell(s) each viewer has selected
 * in a table grid. Carried over the shared, already-authenticated Socket.IO
 * connection (the server relay is `apps/realtime/src/handlers/tables.ts`),
 * separate from the one-way durable cell-status stream (`lib/table/events.ts`).
 *
 * Centralized here so the server emits and the client subscriptions cannot drift.
 * This module is pure so both `apps/sim` and `apps/realtime` can import it.
 */

/** Socket.IO event names for the table presence channel. */
export const TABLE_PRESENCE_EVENTS = {
  JOIN: 'join-table',
  JOIN_SUCCESS: 'join-table-success',
  JOIN_ERROR: 'join-table-error',
  LEAVE: 'leave-table',
  /**
   * The sender's current cell selection. Sent client→server, then relayed
   * server→peers with the sender's identity attached.
   */
  CELL_SELECTION: 'table-cell-selection',
} as const

/**
 * A single cell address. Keyed by stable ids (never positional indices): row and
 * column order differ per client under their own sort/filter, so an index would
 * point at the wrong cell on the receiver.
 */
export interface TableCellRef {
  rowId: string
  columnId: string
}

/**
 * A viewer's grid selection: the `anchor` and `focus` corners of a rectangular
 * range (a single-cell selection has `anchor` equal to `focus`). `null` clears
 * the selection (the viewer has nothing selected).
 */
export type TableCellSelection = {
  anchor: TableCellRef
  focus: TableCellRef
  /**
   * True while the viewer is actively editing the `focus` cell (they double-clicked
   * or started typing). Peers render the cell with a slightly darker fill — the
   * Google-Sheets "someone is typing here" signal — on top of the color border.
   */
  editing?: boolean
} | null

/** Client→server join request for a table presence room. */
export interface JoinTablePayload {
  tableId: string
  /** Stable per-tab id so a reconnecting tab replaces its own stale presence entry. */
  tabSessionId?: string
}

/** Server→client rejection of a {@link TABLE_PRESENCE_EVENTS.JOIN}. */
export interface JoinTableError {
  tableId: string
  error: string
  code:
    | 'AUTHENTICATION_REQUIRED'
    | 'ROOM_MANAGER_UNAVAILABLE'
    | 'INVALID_PAYLOAD'
    | 'VERIFY_ACCESS_FAILED'
    | 'NOT_FOUND'
    | 'ACCESS_DENIED'
    | 'JOIN_FAILED'
  /** Whether re-attempting the join (e.g. after reconnect) could succeed. */
  retryable: boolean
}

/**
 * A remote viewer of a table, as carried in the join ack and every
 * `table:presence-update` broadcast. `cell` is the viewer's current selection at
 * broadcast time (absent until they select something).
 */
export interface TablePresenceUser {
  socketId: string
  userId: string
  userName: string
  avatarUrl?: string | null
  cell?: TableCellSelection
}

/** Server→client ack of a successful join, carrying the room's current viewers. */
export interface JoinTableSuccess {
  tableId: string
  socketId: string
  presenceUsers: TablePresenceUser[]
}

/**
 * A single remote viewer's cell-selection delta, relayed to peers on
 * {@link TABLE_PRESENCE_EVENTS.CELL_SELECTION}. Lower-latency than a full
 * presence broadcast for the frequent case of just moving the selection — the
 * same viewer shape as {@link TablePresenceUser}, but with `cell` always present.
 */
export type TableCellSelectionBroadcast = TablePresenceUser & { cell: TableCellSelection }

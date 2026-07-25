/**
 * Per-table event buffer for live cell-state updates.
 *
 * The grid subscribes to a per-table SSE stream and patches its React Query cache
 * as events arrive. This is a thin domain adapter over the generic durable event
 * log (`@/lib/realtime/event-log`): it owns the Redis key prefix (`table:stream:`)
 * and the entry wire shape (`{ eventId, tableId, event }`), and gets append/read/
 * tail + replay + prune semantics from the core. Every status transition appends
 * here with a monotonic eventId; SSE clients resume on reconnect via
 * `?from=<lastEventId>` and the server replays from this buffer.
 *
 * The `table:stream:` prefix and the entry shape are a wire contract — renaming
 * the prefix resets the seq counter and silently strands connected clients (their
 * in-memory `lastEventId` no longer matches), so both are intentionally fixed here.
 */

import {
  appendEvent,
  type EventLogConfig,
  type EventLogReadResult,
  getLatestEventId,
  readEventsSince,
} from '@/lib/realtime/event-log'

export const TABLE_EVENT_TTL_SECONDS = 60 * 60 // 1 hour
export const TABLE_EVENT_CAP = 5000
/** Max events returned by a single read; the SSE route drains in chunks. */
export const TABLE_EVENT_READ_CHUNK = 500

/** Wire contract — see the file header; the prefix must never change. */
const TABLE_EVENT_LOG: EventLogConfig = {
  prefix: 'table:stream:',
  ttlSeconds: TABLE_EVENT_TTL_SECONDS,
  cap: TABLE_EVENT_CAP,
  readChunk: TABLE_EVENT_READ_CHUNK,
}

export type TableCellStatus = 'pending' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'

export type TableDispatchStatus = 'pending' | 'dispatching' | 'complete' | 'cancelled'

export type TableEvent =
  | {
      kind: 'cell'
      tableId: string
      rowId: string
      groupId: string
      status: TableCellStatus
      executionId: string | null
      jobId: string | null
      error: string | null
      /**
       * Present when this transition wrote new output values; absent on
       * pure-status transitions (queued, running, cancelled). The publisher
       * already has these in hand from the same updateRow call that wrote DB.
       */
      outputs?: Record<string, unknown>
      /**
       * Block-level metadata the renderer reads to distinguish "running" (some
       * block actively executing) from "pending-upstream" (run started but this
       * column's block hasn't fired yet). The worker fills these on partial
       * writes; without them the cell stays on the amber Pending pill.
       */
      runningBlockIds?: string[]
      blockErrors?: Record<string, string>
    }
  | {
      /** Dispatcher status signal emitted by `dispatcherStep` and the cancel
       *  path. Drives the client-side "about to run" overlay for rows the
       *  dispatcher hasn't reached yet. `scope` + `cursor` + `mode` +
       *  `isManualRun` are carried on every transition so the client can
       *  upsert without refetching the dispatches list. */
      kind: 'dispatch'
      tableId: string
      dispatchId: string
      status: TableDispatchStatus
      scope?: { groupIds: string[]; rowIds?: string[] }
      cursor?: number
      mode?: 'all' | 'incomplete' | 'new'
      isManualRun?: boolean
      /** Present when the run is capped — carried so the client overlay can
       *  skip capped dispatches (see `resolveCellExec`). */
      limit?: { type: 'rows'; max: number }
    }
  | {
      /** Async background-job progress. Import and delete workers emit `running`
       *  ticks as batches commit, then a terminal `ready`/`failed`/`canceled`.
       *  `type` discriminates the work. The client reveals hidden import rows on
       *  `ready`, and on a delete `failed`/`canceled` restores optimistically
       *  hidden rows. See `import-runner.ts` / `delete-runner.ts`. */
      kind: 'job'
      tableId: string
      jobId: string
      type: 'import' | 'delete' | 'export' | 'backfill' | 'update'
      status: 'running' | 'ready' | 'failed' | 'canceled'
      /** Rows processed so far (running) or in total (ready). */
      progress?: number
      /** Byte-based completion percent (0–100) — exact and monotonic, for the determinate bar. */
      percent?: number
      error?: string
    }
  | {
      /** A dispatch was stopped because the billed account is over its usage
       *  limit. The client surfaces an upgrade prompt and redirects to billing.
       *  The dispatch is halted via `markDispatchComplete` and the blocked
       *  cells' pre-stamps are cleared so they revert to un-run. `dispatchId`
       *  is absent for cascade/auto-fire payloads with no owning dispatch. */
      kind: 'usageLimitReached'
      tableId: string
      dispatchId?: string
      message: string
    }
  | {
      /** A user made a manual cell-value edit (a plain row write, not an
       *  execution). Signals collaborators to refetch the row so the winning
       *  value shows live — last-write-wins is simply the DB's committed order.
       *  Carries no value: peers refetch in their own wire format, avoiding
       *  auth-specific value translation on the wire. */
      kind: 'edit'
      tableId: string
      rowId: string
    }

export interface TableEventEntry {
  eventId: number
  tableId: string
  event: TableEvent
}

export type TableEventsReadResult = EventLogReadResult<TableEventEntry>

/**
 * Append an event to the table's buffer. Fire-and-forget — never throws, returns
 * null on failure (a Redis blip must not fail a cell-write). The Redis (Lua splice)
 * and in-memory paths are built to produce byte-identical entries.
 */
export async function appendTableEvent(event: TableEvent): Promise<TableEventEntry | null> {
  return appendEvent<TableEventEntry>(TABLE_EVENT_LOG, event.tableId, {
    entryPrefix: '{"eventId":',
    entrySuffix: `,"tableId":${JSON.stringify(event.tableId)},"event":${JSON.stringify(event)}}`,
    buildMemory: (eventId) => ({ eventId, tableId: event.tableId, event }),
  })
}

/**
 * The latest eventId assigned for a table, or 0 when the buffer is empty or
 * expired. Used by the stream route to tail from "now" when a client connects
 * without a replay cursor.
 */
export function getLatestTableEventId(tableId: string): Promise<number> {
  return getLatestEventId(TABLE_EVENT_LOG, tableId)
}

/**
 * Read events for a table where eventId > afterEventId. Returns 'pruned' if the
 * caller has fallen off the back of the buffer (TTL expired or cap rolled past
 * their lastEventId).
 */
export function readTableEventsSince(
  tableId: string,
  afterEventId: number
): Promise<TableEventsReadResult> {
  return readEventsSince<TableEventEntry>(TABLE_EVENT_LOG, tableId, afterEventId)
}

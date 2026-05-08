'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { tableKeys, type TableRowsResponse } from '@/hooks/queries/tables'
import type { RowData, RowExecutionMetadata, RowExecutions, TableRow } from '@/lib/table'

const logger = createLogger('useTableEventStream')

/** Mirrors the server-side `TableCellStatus` from `apps/sim/lib/table/events.ts`. */
type TableCellStatus = 'pending' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'

interface TableCellEvent {
  kind: 'cell'
  tableId: string
  rowId: string
  groupId: string
  status: TableCellStatus
  executionId: string | null
  jobId: string | null
  error: string | null
  outputs?: Record<string, unknown>
}

interface TableEventEntry {
  eventId: number
  tableId: string
  event: TableCellEvent
}

interface PrunedEvent {
  earliestEventId: number | null
}

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

interface UseTableEventStreamArgs {
  tableId: string | undefined
  workspaceId: string | undefined
  enabled?: boolean
}

/**
 * Subscribes to the table's SSE event stream and patches the React Query
 * cache as cell-state events arrive. Replaces polling — once the page mounts,
 * cells flip in <100ms via push instead of waiting for the next poll tick.
 *
 * Reconnect-resume: on transport error, the hook reconnects with `from=` set
 * to the last seen `eventId`; the server replays anything missed from the
 * Redis-backed buffer. If the buffer has rolled past the gap (server returns
 * a `pruned` event), the hook full-refetches the row queries and resumes
 * streaming from the new earliest.
 *
 * Returns nothing — the only side effect is keeping the cache live. Cleans
 * up the EventSource on unmount or argument change.
 */
export function useTableEventStream({
  tableId,
  workspaceId,
  enabled = true,
}: UseTableEventStreamArgs): void {
  const queryClient = useQueryClient()

  // Refs so the long-lived stream loop reads current values without forcing
  // effect re-subscription on every render.
  const lastEventIdRef = useRef(0)
  const reconnectAttemptRef = useRef(0)

  useEffect(() => {
    if (!enabled || !tableId || !workspaceId) return

    let cancelled = false
    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    // Reset the dedupe cursor on every fresh mount so a remount after
    // navigation doesn't accidentally skip events from a prior session.
    lastEventIdRef.current = 0
    reconnectAttemptRef.current = 0

    const patchRow = (entry: TableEventEntry): void => {
      const { rowId, groupId, status, executionId, jobId, error, outputs } = entry.event
      const nextExec: RowExecutionMetadata = {
        status,
        executionId: executionId ?? null,
        jobId: jobId ?? null,
        // workflowId is required by the type but not in the SSE payload — we
        // preserve any prior value via the merge below; if there's no prior
        // value, the empty string is overwritten on the next refetch.
        workflowId: '',
        error: error ?? null,
      }

      const queries = queryClient.getQueriesData<unknown>({
        queryKey: tableKeys.rowsRoot(tableId),
      })
      for (const [queryKey, data] of queries) {
        if (!data) continue
        const patched = patchCacheEntry(data, rowId, groupId, nextExec, outputs)
        if (patched !== data) {
          queryClient.setQueryData(queryKey, patched)
        }
      }
    }

    const handlePrune = (payload: PrunedEvent): void => {
      logger.info('Table event buffer pruned — full refetch', { tableId, ...payload })
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      // Resume streaming from the new earliest. The next reconnect picks
      // this up via lastEventIdRef.current.
      if (typeof payload.earliestEventId === 'number') {
        lastEventIdRef.current = payload.earliestEventId
      } else {
        lastEventIdRef.current = 0
      }
    }

    const scheduleReconnect = (): void => {
      if (cancelled) return
      const attempt = Math.min(reconnectAttemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
      const delay = RECONNECT_BACKOFF_MS[attempt]
      reconnectAttemptRef.current++
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = (): void => {
      if (cancelled) return
      const url = `/api/table/${tableId}/events/stream?from=${lastEventIdRef.current}`
      try {
        eventSource = new EventSource(url)
      } catch (err) {
        logger.warn('Failed to open table event stream', { tableId, err })
        scheduleReconnect()
        return
      }

      eventSource.onopen = () => {
        reconnectAttemptRef.current = 0
      }

      eventSource.onmessage = (msg: MessageEvent<string>) => {
        try {
          const entry = JSON.parse(msg.data) as TableEventEntry
          if (entry.event?.kind !== 'cell') return
          if (entry.eventId <= lastEventIdRef.current) return
          lastEventIdRef.current = entry.eventId
          patchRow(entry)
        } catch (err) {
          logger.warn('Failed to parse table event', { tableId, err })
        }
      }

      eventSource.addEventListener('pruned', (msg: MessageEvent<string>) => {
        try {
          handlePrune(JSON.parse(msg.data) as PrunedEvent)
        } catch {
          handlePrune({ earliestEventId: null })
        }
      })

      eventSource.addEventListener('rotate', () => {
        // Server hit its defensive duration ceiling — close + reconnect.
        eventSource?.close()
        eventSource = null
        scheduleReconnect()
      })

      eventSource.onerror = () => {
        if (cancelled) return
        eventSource?.close()
        eventSource = null
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      eventSource?.close()
      eventSource = null
    }
  }, [enabled, tableId, workspaceId, queryClient])
}

/**
 * Returns a new cache entry with the given row's executions/data patched, or
 * the original reference if the row isn't in this entry. Handles both
 * single-page (`useTableRows`) and infinite (`useInfiniteTableRows`) shapes.
 *
 * Within a page we only allocate a new row object when it actually changes;
 * unchanged rows keep their reference so memoized `<DataRow>` short-circuits.
 */
function patchCacheEntry(
  entry: unknown,
  rowId: string,
  groupId: string,
  nextExec: RowExecutionMetadata,
  outputs: Record<string, unknown> | undefined
): unknown {
  if (isInfiniteCache(entry)) {
    let touched = false
    const nextPages = entry.pages.map((page) => {
      const nextRows = patchRows(page.rows, rowId, groupId, nextExec, outputs)
      if (nextRows === page.rows) return page
      touched = true
      return { ...page, rows: nextRows }
    })
    if (!touched) return entry
    return { ...entry, pages: nextPages }
  }
  if (isSinglePage(entry)) {
    const nextRows = patchRows(entry.rows, rowId, groupId, nextExec, outputs)
    if (nextRows === entry.rows) return entry
    return { ...entry, rows: nextRows }
  }
  return entry
}

function patchRows(
  rows: TableRow[],
  rowId: string,
  groupId: string,
  nextExec: RowExecutionMetadata,
  outputs: Record<string, unknown> | undefined
): TableRow[] {
  let touched = false
  const next = rows.map((row) => {
    if (row.id !== rowId) return row
    const prevExec = row.executions?.[groupId]
    // Preserve the prior workflowId — the SSE payload doesn't carry it but
    // the cache row may already have it from the page query.
    const mergedExec: RowExecutionMetadata = {
      ...nextExec,
      workflowId: prevExec?.workflowId ?? nextExec.workflowId,
    }
    const nextExecutions: RowExecutions = { ...(row.executions ?? {}), [groupId]: mergedExec }
    const nextData: RowData = outputs
      ? ({ ...row.data, ...outputs } as RowData)
      : row.data
    touched = true
    return { ...row, executions: nextExecutions, data: nextData }
  })
  return touched ? next : rows
}

interface InfiniteCache {
  pages: TableRowsResponse[]
  pageParams: number[]
}

function isInfiniteCache(value: unknown): value is InfiniteCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as InfiniteCache).pages) &&
    Array.isArray((value as InfiniteCache).pageParams)
  )
}

function isSinglePage(value: unknown): value is TableRowsResponse {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as TableRowsResponse).rows)
  )
}

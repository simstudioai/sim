'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import type { RowData, RowExecutionMetadata, RowExecutions } from '@/lib/table'
import type { TableEvent, TableEventEntry } from '@/lib/table/events'
import { snapshotAndMutateRows, tableKeys } from '@/hooks/queries/tables'

const logger = createLogger('useTableEventStream')

interface PrunedEvent {
  earliestEventId: number | null
}

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]
const POINTER_PREFIX = 'table-event-stream-pointer:'

function loadPointer(tableId: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.sessionStorage.getItem(`${POINTER_PREFIX}${tableId}`)
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

function savePointer(tableId: string, eventId: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(`${POINTER_PREFIX}${tableId}`, String(eventId))
  } catch {
    // sessionStorage can throw under quota / private mode — ignore.
  }
}

interface UseTableEventStreamArgs {
  tableId: string | undefined
  workspaceId: string | undefined
  enabled?: boolean
}

/**
 * Subscribes to the table's SSE event stream and patches the React Query
 * cache as cell-state events arrive.
 *
 * Reconnect-resume: on transport error, reconnects with `from=` set to the
 * last seen `eventId`; server replays missed events from the Redis-backed
 * buffer. If the gap exceeds buffer retention (server emits `pruned`), the
 * hook full-refetches the row queries and resumes from the new earliest.
 */
export function useTableEventStream({
  tableId,
  workspaceId,
  enabled = true,
}: UseTableEventStreamArgs): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !tableId || !workspaceId) return

    let cancelled = false
    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    // Resume from the last seen eventId persisted in sessionStorage. Survives
    // tab refresh; if the buffer has rolled past this id the server replies
    // `pruned` and we full-refetch + restart from the new earliest.
    let lastEventId = loadPointer(tableId)
    let reconnectAttempt = 0

    const applyCell = (event: Extract<TableEvent, { kind: 'cell' }>): void => {
      const {
        rowId,
        groupId,
        status,
        executionId,
        jobId,
        error,
        outputs,
        runningBlockIds,
        blockErrors,
      } = event
      void snapshotAndMutateRows(
        queryClient,
        tableId,
        (row) => {
          if (row.id !== rowId) return null
          const prevExec = row.executions?.[groupId]
          const nextExec: RowExecutionMetadata = {
            status,
            executionId: executionId ?? null,
            jobId: jobId ?? null,
            // Preserve workflowId from cache; SSE payload doesn't carry it.
            workflowId: prevExec?.workflowId ?? '',
            error: error ?? null,
            ...(runningBlockIds ? { runningBlockIds } : {}),
            ...(blockErrors ? { blockErrors } : {}),
          }
          const nextExecutions: RowExecutions = {
            ...(row.executions ?? {}),
            [groupId]: nextExec,
          }
          const nextData: RowData = outputs ? ({ ...row.data, ...outputs } as RowData) : row.data
          return { ...row, executions: nextExecutions, data: nextData }
        },
        { cancelInFlight: false }
      )
    }

    const handlePrune = (payload: PrunedEvent): void => {
      logger.info('Table event buffer pruned — full refetch', { tableId, ...payload })
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      lastEventId = typeof payload.earliestEventId === 'number' ? payload.earliestEventId : 0
      savePointer(tableId, lastEventId)
      // Close proactively so the server's close doesn't fire onerror and route
      // through the backoff path. Reconnect immediately from the new cursor.
      eventSource?.close()
      eventSource = null
      reconnectAttempt = 0
      connect()
    }

    const scheduleReconnect = (): void => {
      if (cancelled) return
      const idx = Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
      const delay = RECONNECT_BACKOFF_MS[idx]
      reconnectAttempt++
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = (): void => {
      if (cancelled) return
      const url = `/api/table/${tableId}/events/stream?from=${lastEventId}`
      try {
        eventSource = new EventSource(url)
      } catch (err) {
        logger.warn('Failed to open table event stream', { tableId, err })
        scheduleReconnect()
        return
      }

      eventSource.onopen = () => {
        reconnectAttempt = 0
      }

      eventSource.onmessage = (msg: MessageEvent<string>) => {
        try {
          const entry = JSON.parse(msg.data) as TableEventEntry
          if (entry.event?.kind !== 'cell') return
          if (entry.eventId <= lastEventId) return
          lastEventId = entry.eventId
          savePointer(tableId, lastEventId)
          applyCell(entry.event)
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

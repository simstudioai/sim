'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { snapshotAndMutateRows, tableKeys } from '@/hooks/queries/tables'
import type { TableEvent, TableEventEntry } from '@/lib/table/events'
import type { RowData, RowExecutionMetadata, RowExecutions } from '@/lib/table'

const logger = createLogger('useTableEventStream')

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
    let lastEventId = 0
    let reconnectAttempt = 0

    const applyCell = (event: Extract<TableEvent, { kind: 'cell' }>): void => {
      const { rowId, groupId, status, executionId, jobId, error, outputs } = event
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
          }
          const nextExecutions: RowExecutions = {
            ...(row.executions ?? {}),
            [groupId]: nextExec,
          }
          const nextData: RowData = outputs
            ? ({ ...row.data, ...outputs } as RowData)
            : row.data
          return { ...row, executions: nextExecutions, data: nextData }
        },
        { cancelInFlight: false }
      )
    }

    const handlePrune = (payload: PrunedEvent): void => {
      logger.info('Table event buffer pruned — full refetch', { tableId, ...payload })
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      lastEventId = typeof payload.earliestEventId === 'number' ? payload.earliestEventId : 0
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

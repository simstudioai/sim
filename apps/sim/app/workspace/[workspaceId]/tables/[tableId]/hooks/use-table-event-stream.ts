'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import type { ActiveDispatch } from '@/lib/api/contracts/tables'
import type { RowData, RowExecutionMetadata, RowExecutions, TableDefinition } from '@/lib/table'
import { isExecInFlight } from '@/lib/table/deps'
import type { TableEvent, TableEventEntry } from '@/lib/table/events'
import { snapshotAndMutateRows, type TableRunState, tableKeys } from '@/hooks/queries/tables'

const logger = createLogger('useTableEventStream')

interface PrunedEvent {
  earliestEventId: number | null
}

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]
const POINTER_PREFIX = 'table-event-stream-pointer:'
const DISPATCH_INVALIDATE_DEBOUNCE_MS = 250

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
  /** Fired when the server halts a dispatch because the billed account is over
   *  its usage limit. The page surfaces an upgrade prompt + redirect. */
  onUsageLimitReached?: (event: { dispatchId?: string; message: string }) => void
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
  onUsageLimitReached,
}: UseTableEventStreamArgs): void {
  const queryClient = useQueryClient()

  // Ref so a changing callback identity doesn't tear down + reconnect the SSE.
  const onUsageLimitReachedRef = useRef(onUsageLimitReached)
  onUsageLimitReachedRef.current = onUsageLimitReached

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

    // Trailing-edge debounce coalesces window-completion bursts.
    let dispatchInvalidateTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleDispatchInvalidate = (): void => {
      if (dispatchInvalidateTimer !== null) clearTimeout(dispatchInvalidateTimer)
      dispatchInvalidateTimer = setTimeout(() => {
        dispatchInvalidateTimer = null
        void queryClient.invalidateQueries({ queryKey: tableKeys.activeDispatches(tableId) })
      }, DISPATCH_INVALIDATE_DEBOUNCE_MS)
    }

    // Live-fill: import progress ticks arrive every N rows; coalesce the row
    // refetches into one per debounce window instead of refetching per tick.
    let importInvalidateTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRowsInvalidate = (): void => {
      if (importInvalidateTimer !== null) clearTimeout(importInvalidateTimer)
      importInvalidateTimer = setTimeout(() => {
        importInvalidateTimer = null
        void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      }, DISPATCH_INVALIDATE_DEBOUNCE_MS)
    }

    // Keeps the per-row gutter (`runningByRowId`) live between dispatch events.
    // `runningCellCount` (the "X running" badge) is NOT touched here — it's the
    // server's dispatch-scope count, seeded optimistically on click and
    // re-synced by `applyDispatch` on every window, so live matches reload.
    const updateRunningByRow = (rowId: string, wasInFlight: boolean, isInFlight: boolean): void => {
      if (wasInFlight === isInFlight) return
      const delta = isInFlight ? 1 : -1
      queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
        if (!prev) return prev
        const prevForRow = prev.runningByRowId[rowId] ?? 0
        const nextForRow = Math.max(0, prevForRow + delta)
        const nextByRow = { ...prev.runningByRowId }
        if (nextForRow === 0) delete nextByRow[rowId]
        else nextByRow[rowId] = nextForRow
        return { ...prev, runningByRowId: nextByRow }
      })
    }

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
      let wasInFlight: boolean | null = null
      void snapshotAndMutateRows(
        queryClient,
        tableId,
        (row) => {
          if (row.id !== rowId) return null
          const prevExec = row.executions?.[groupId]
          // In-flight = queued | running | pending. Server's countRunningCells
          // counts all three (the gutter Run/Stop button reads this map and
          // needs Stop visible during queued too, else clicking Play would
          // re-enqueue a cell that's already queued).
          if (wasInFlight === null) wasInFlight = isExecInFlight(prevExec)
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
      if (wasInFlight === null) {
        // Row outside the loaded page slice — can't compute the delta locally.
        // Refetch the run-state snapshot from the server. Cheap and rare.
        scheduleDispatchInvalidate()
      } else {
        updateRunningByRow(rowId, wasInFlight, isExecInFlight({ status } as RowExecutionMetadata))
      }
    }

    const applyDispatch = (event: Extract<TableEvent, { kind: 'dispatch' }>): void => {
      const { dispatchId, status, scope, cursor, mode, isManualRun, limit } = event
      queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
        // SSE may arrive before the initial fetch lands. Seed an empty
        // run-state so the dispatch isn't dropped; counters are reconciled
        // by the subsequent fetch / per-cell SSE events.
        const base: TableRunState = prev ?? {
          dispatches: [],
          runningCellCount: 0,
          runningByRowId: {},
        }
        const list = base.dispatches
        // Terminal states drop the dispatch from the overlay; client renders
        // the row's authoritative DB exec state from here.
        if (status === 'complete' || status === 'cancelled') {
          const filtered = list.filter((d) => d.id !== dispatchId)
          return filtered.length === list.length ? base : { ...base, dispatches: filtered }
        }
        if (scope === undefined || cursor === undefined || mode === undefined) {
          // Defensive: a legacy emit without the new fields can't drive the
          // overlay. Leave existing cache alone.
          return base
        }
        const idx = list.findIndex((d) => d.id === dispatchId)
        const existing = idx === -1 ? undefined : list[idx]
        // Prefer the event payload (current truth from server); fall back to
        // the cached entry's value if this is a legacy emit without the
        // field, and finally to `false` if we have nothing.
        const resolvedManualRun = isManualRun ?? existing?.isManualRun ?? false
        const resolvedLimit = limit ?? existing?.limit
        const next: ActiveDispatch = {
          id: dispatchId,
          status,
          mode,
          isManualRun: resolvedManualRun,
          cursor,
          scope,
          ...(resolvedLimit ? { limit: resolvedLimit } : {}),
        }
        if (idx === -1) return { ...base, dispatches: [...list, next] }
        const merged = list.slice()
        merged[idx] = next
        return { ...base, dispatches: merged }
      })
      // The dispatcher emits this once per window (after the window's cells
      // finish + the cursor advances) and on completion. Re-sync the
      // dispatch-scope `runningCellCount` from the server so the badge steps
      // down per window and matches a reload exactly.
      scheduleDispatchInvalidate()
    }

    const applyImport = (event: Extract<TableEvent, { kind: 'import' }>): void => {
      const { status, progress, error, importId } = event
      const isTerminal = status === 'ready' || status === 'failed' || status === 'canceled'

      // The SSE buffer replays on (re)connect and can hold a *prior* import's events for this
      // table. Ignore anything from a superseded run, and don't trust a replayed terminal before
      // we know the active run's id.
      const prev = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
      const lockedId = prev?.importId
      if (lockedId && importId && importId !== lockedId) return
      if (!lockedId && isTerminal) return

      queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), (p) =>
        p
          ? {
              ...p,
              importStatus: status,
              importId: importId ?? p.importId,
              importRowsProcessed: progress ?? p.importRowsProcessed,
              importError: error ?? null,
            }
          : p
      )
      // The header tray + completion toast are owned by `useImportTrayPoll`. Here we only keep the
      // detail cache + grid in sync: live-fill rows per batch (debounced), and on the terminal
      // event refetch rows + the definition (the worker may have rewritten the schema).
      if (isTerminal) {
        if (importInvalidateTimer !== null) clearTimeout(importInvalidateTimer)
        void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
        void queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
      } else {
        scheduleRowsInvalidate()
      }
    }

    const applyUsageLimit = (event: Extract<TableEvent, { kind: 'usageLimitReached' }>): void => {
      // Drop the halted dispatch from the overlay so the "running" UI clears
      // immediately (the dispatcher was marked complete server-side). Cascade /
      // auto-fire events carry no dispatchId — nothing to remove.
      if (event.dispatchId) {
        queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
          if (!prev) return prev
          const filtered = prev.dispatches.filter((d) => d.id !== event.dispatchId)
          return filtered.length === prev.dispatches.length
            ? prev
            : { ...prev, dispatches: filtered }
        })
      }
      // Blocked cells are left `queued` in the DB with no terminal cell event,
      // so `runningByRowId` would otherwise stay non-zero (stale "X running").
      // Re-sync the server counts, and refetch rows so cells whose pre-stamps
      // the server cleared drop their "Queued" state.
      scheduleDispatchInvalidate()
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      onUsageLimitReachedRef.current?.({ dispatchId: event.dispatchId, message: event.message })
    }

    const handlePrune = (payload: PrunedEvent): void => {
      logger.info('Table event buffer pruned — full refetch', { tableId, ...payload })
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      scheduleDispatchInvalidate()
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
          if (entry.eventId <= lastEventId) return
          lastEventId = entry.eventId
          savePointer(tableId, lastEventId)
          if (entry.event?.kind === 'cell') applyCell(entry.event)
          else if (entry.event?.kind === 'dispatch') applyDispatch(entry.event)
          else if (entry.event?.kind === 'import') applyImport(entry.event)
          else if (entry.event?.kind === 'usageLimitReached') applyUsageLimit(entry.event)
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
      if (dispatchInvalidateTimer !== null) clearTimeout(dispatchInvalidateTimer)
      if (importInvalidateTimer !== null) clearTimeout(importInvalidateTimer)
      eventSource?.close()
      eventSource = null
    }
  }, [enabled, tableId, workspaceId, queryClient])
}

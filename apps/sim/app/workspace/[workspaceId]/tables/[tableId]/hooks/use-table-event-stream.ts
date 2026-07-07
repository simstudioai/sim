'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { backoffWithJitter } from '@sim/utils/retry'
import { useQueryClient } from '@tanstack/react-query'
import type { ActiveDispatch } from '@/lib/api/contracts/tables'
import type { RowData, RowExecutionMetadata, RowExecutions, TableDefinition } from '@/lib/table'
import type { TableEvent, TableEventEntry } from '@/lib/table/events'
import {
  consumeInitiatedExport,
  downloadExportResult,
  snapshotAndMutateRows,
  type TableRunState,
} from '@/hooks/queries/tables'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

const logger = createLogger('useTableEventStream')

interface PrunedEvent {
  earliestEventId: number | null
}

const RECONNECT_BACKOFF_BASE_MS = 500
const RECONNECT_BACKOFF_MAX_MS = 10_000
const RUN_STATE_REFETCH_THROTTLE_MS = 1_000
const ROWS_INVALIDATE_DEBOUNCE_MS = 250

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
 * Fresh mount tails from the latest event — the rows + run-state queries
 * fetch current state from the DB, so replaying buffered history would only
 * rewind fresh cells through stale intermediate states (queued → running →
 * completed churn). Reconnect-resume: on transport error, reconnects with
 * `from=` set to the last seen `eventId`; server replays missed events from
 * the Redis-backed buffer. If the gap exceeds buffer retention (server emits
 * `pruned`), the hook full-refetches and resumes tailing from latest.
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
    // `null` = no cursor yet: connect without `from` and tail from latest.
    // Advanced in memory per event; within-session reconnects resume from it.
    let lastEventId: number | null = null
    let reconnectAttempt = 0

    // Leading + trailing throttle for run-state refetches. Cell/dispatch SSE
    // events arrive in bursts (the server flushes its buffer every 500ms): the
    // leading edge keeps the badge stepping promptly on sporadic completions;
    // the trailing timer coalesces a burst into one refetch per interval. A
    // debounce would starve here — sustained bursts reset it indefinitely.
    let runStateInvalidateTimer: ReturnType<typeof setTimeout> | null = null
    let lastRunStateInvalidateAt = 0
    let runStateFetchInFlight = false
    let runStateDirtyDuringFetch = false
    const invalidateRunState = async (): Promise<void> => {
      lastRunStateInvalidateAt = Date.now()
      // cancelRefetch: false — the default (true) cancels an in-flight refetch
      // and restarts it. When the run-state fetch is slower than the throttle
      // interval (a busy run congests the server), that livelocks: every
      // interval kills the previous fetch before it can land and the badge
      // freezes on the last value that ever resolved. Instead, let an
      // in-flight fetch complete (slightly stale counts land), remember that
      // events arrived meanwhile, and run one follow-up afterwards — without
      // the follow-up, a run's final events deduping into a stale fetch would
      // freeze the badge non-zero forever.
      if (runStateFetchInFlight) {
        runStateDirtyDuringFetch = true
        return
      }
      runStateFetchInFlight = true
      try {
        await queryClient.invalidateQueries(
          { queryKey: tableKeys.activeDispatches(tableId) },
          { cancelRefetch: false }
        )
      } finally {
        runStateFetchInFlight = false
        if (runStateDirtyDuringFetch) {
          runStateDirtyDuringFetch = false
          scheduleDispatchInvalidate()
        }
      }
    }
    const scheduleDispatchInvalidate = (): void => {
      if (cancelled || runStateInvalidateTimer !== null) return
      const elapsed = Date.now() - lastRunStateInvalidateAt
      if (elapsed >= RUN_STATE_REFETCH_THROTTLE_MS) {
        void invalidateRunState()
        return
      }
      runStateInvalidateTimer = setTimeout(() => {
        runStateInvalidateTimer = null
        void invalidateRunState()
      }, RUN_STATE_REFETCH_THROTTLE_MS - elapsed)
    }
    /** Urgent resync (usage-limit halt, prune recovery) — skips the throttle.
     *  Default cancelRefetch here: a fetch started before the halt is stale by
     *  definition, so kill it and read fresh. One-shot, so no churn risk. */
    const invalidateDispatchesNow = (): void => {
      if (runStateInvalidateTimer !== null) {
        clearTimeout(runStateInvalidateTimer)
        runStateInvalidateTimer = null
      }
      lastRunStateInvalidateAt = Date.now()
      void queryClient.invalidateQueries({ queryKey: tableKeys.activeDispatches(tableId) })
    }

    // Live-fill: import progress ticks arrive every N rows; coalesce the row
    // refetches into one per debounce window instead of refetching per tick.
    let jobInvalidateTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRowsInvalidate = (): void => {
      if (jobInvalidateTimer !== null) clearTimeout(jobInvalidateTimer)
      jobInvalidateTimer = setTimeout(() => {
        jobInvalidateTimer = null
        void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      }, ROWS_INVALIDATE_DEBOUNCE_MS)
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
      // `runningByRowId` (the "X running" badge + per-row gutter) is
      // server-derived: refetch the snapshot on the throttle instead of
      // maintaining client-side ±1 deltas, which drift on unloaded rows,
      // replays, and races with optimistic stamps.
      scheduleDispatchInvalidate()
    }

    const applyDispatch = (event: Extract<TableEvent, { kind: 'dispatch' }>): void => {
      const { dispatchId, status, scope, cursor, mode, isManualRun, limit } = event
      queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
        // SSE may arrive before the initial fetch lands. Seed an empty
        // run-state so the dispatch isn't dropped; counters are reconciled
        // by the subsequent fetch.
        const base: TableRunState = prev ?? {
          dispatches: [],
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
      // finish + the cursor advances) and on completion. Re-sync
      // `runningByRowId` from the server so the badge steps down per window
      // and matches a reload exactly.
      scheduleDispatchInvalidate()
    }

    const applyJob = (event: Extract<TableEvent, { kind: 'job' }>): void => {
      const { type, status, progress, error, jobId } = event
      const isTerminal = status === 'ready' || status === 'failed' || status === 'canceled'

      // Exports run concurrently with other jobs and never touch the detail-cache job fields
      // (those derive from the latest *non-export* job). Their only client effect: download the
      // file when an export this session kicked off completes. The initiated-set guard is what
      // keeps replayed `ready` events (SSE re-delivers up to 1h on reconnect) from re-downloading.
      if (type === 'export') {
        // Keep the tray's export list fresh between its polls.
        void queryClient.invalidateQueries({ queryKey: tableKeys.exportJobs(workspaceId) })
        if (status === 'ready' && jobId && consumeInitiatedExport(jobId)) {
          void downloadExportResult(workspaceId, tableId, jobId)
            .then(() => toast.success('Export ready — downloading'))
            .catch((err) => {
              logger.error('Export download failed', { tableId, jobId, err })
              toast.error('Export finished but the download failed — try again from the table menu')
            })
        } else if (status === 'failed' && jobId && consumeInitiatedExport(jobId)) {
          toast.error(error || 'Export failed')
        }
        return
      }

      // The SSE buffer replays on (re)connect and can hold a *prior* job's events for this table.
      // Ignore anything from a superseded run, and don't trust a replayed terminal before we know
      // the active run's id.
      const prev = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
      const lockedId = prev?.jobId
      if (lockedId && jobId && jobId !== lockedId) return
      if (!lockedId && isTerminal) return

      queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), (p) =>
        p
          ? {
              ...p,
              jobStatus: status,
              jobId: jobId ?? p.jobId,
              jobType: type,
              jobRowsProcessed: progress ?? p.jobRowsProcessed,
              jobError: error ?? null,
            }
          : p
      )
      // The header tray + completion toast are owned by the tray poll. Here we keep the detail
      // cache + grid in sync. On terminal, refetch rows + the definition (import may have rewritten
      // the schema; delete failure/cancel restores optimistically-hidden rows). While running,
      // imports and backfills live-fill rows per batch; a delete has already optimistically removed
      // its rows, so we don't refetch mid-run (that would flicker not-yet-deleted rows back in).
      if (isTerminal) {
        if (jobInvalidateTimer !== null) clearTimeout(jobInvalidateTimer)
        void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
        void queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
      } else if (type === 'import' || type === 'backfill') {
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
      // Re-sync the server counts immediately (the user is being told they're
      // over limit — the badge must not linger behind the throttle), and
      // refetch rows so cells whose pre-stamps the server cleared drop their
      // "Queued" state.
      invalidateDispatchesNow()
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      onUsageLimitReachedRef.current?.({ dispatchId: event.dispatchId, message: event.message })
    }

    const handlePrune = (payload: PrunedEvent): void => {
      logger.info('Table event buffer pruned — full refetch', { tableId, ...payload })
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      invalidateDispatchesNow()
      // Tail from latest after the refetch — replaying the surviving buffer
      // over freshly-refetched rows would rewind them through stale states.
      lastEventId = null
      // Close proactively so the server's close doesn't fire onerror and route
      // through the backoff path. Reconnect immediately from the new cursor.
      eventSource?.close()
      eventSource = null
      reconnectAttempt = 0
      connect()
    }

    const scheduleReconnect = (): void => {
      if (cancelled) return
      reconnectAttempt++
      const delay = backoffWithJitter(reconnectAttempt, null, {
        baseMs: RECONNECT_BACKOFF_BASE_MS,
        maxMs: RECONNECT_BACKOFF_MAX_MS,
      })
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = (): void => {
      if (cancelled) return
      // No cursor → tail from latest (server-side); otherwise replay-resume.
      const url =
        lastEventId === null
          ? `/api/table/${tableId}/events/stream`
          : `/api/table/${tableId}/events/stream?from=${lastEventId}`
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
          if (lastEventId !== null && entry.eventId <= lastEventId) return
          lastEventId = entry.eventId
          if (entry.event?.kind === 'cell') applyCell(entry.event)
          else if (entry.event?.kind === 'dispatch') applyDispatch(entry.event)
          else if (entry.event?.kind === 'job') applyJob(entry.event)
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

    // In-SPA remount over a warm cache (table A → B → back to A within
    // staleTime): the tail starts at "latest", so transitions that fired while
    // unmounted were neither refetched (cache still fresh) nor replayed.
    // Reconcile once. Cold mounts have no cached run-state → skip, the
    // queries are already fetching.
    if (queryClient.getQueryState(tableKeys.activeDispatches(tableId))?.data !== undefined) {
      void queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
      void invalidateRunState()
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (runStateInvalidateTimer !== null) clearTimeout(runStateInvalidateTimer)
      if (jobInvalidateTimer !== null) clearTimeout(jobInvalidateTimer)
      eventSource?.close()
      eventSource = null
    }
  }, [enabled, tableId, workspaceId, queryClient])
}

'use client'

import { useEffect, useMemo, useRef } from 'react'
import { toast } from '@sim/emcn'
import { useShallow } from 'zustand/react/shallow'
import { useTablesList, useWorkspaceExportJobs } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const READY_AUTO_CLEAR_MS = 6000
const POLL_INTERVAL_MS = 2000

export type ImportPhase = 'importing' | 'ready' | 'failed'

/** A row rendered in the job tray. Import rows come live from the table list (uploads are
 *  client-only until their server row exists); export rows come from the workspace export-jobs
 *  query. Delete/backfill jobs are intentionally excluded — the grid reflects them directly. */
export interface ImportRow {
  /** Table id for imports/uploads; job id for exports (a table can have several exports). */
  id: string
  /** The table the job belongs to — cancel and download need it for export rows. */
  tableId: string
  workspaceId: string
  title: string
  phase: ImportPhase
  jobType: 'import' | 'export'
  rowsProcessed: number
  /** Upload byte percent (upload phase only). */
  percent?: number
  error?: string
  jobId?: string
  /** Export rows: whether the generated file is downloadable. */
  hasResult?: boolean
}

/**
 * Single source for the import tray. Importing rows are derived live from the table list (polled
 * while any job is in flight) rather than mirrored into a store; the store only supplies
 * optimistic uploads and which terminal completions to surface this session. Also fires the
 * completion toasts on the importing → terminal transition. Delete jobs never render as tray rows
 * and only surface a toast on failure (a failed delete restores the optimistically-removed rows).
 */
export function useWorkspaceImports(
  workspaceId: string | undefined,
  scopeTableId?: string
): ImportRow[] {
  const { data: tables } = useTablesList(workspaceId, 'active', {
    refetchInterval: (list) =>
      list?.some((t) => t.jobStatus === 'running') ? POLL_INTERVAL_MS : false,
  })
  // Exports are excluded from the table-level job derivation (they run concurrently with other
  // jobs), so the tray reads them from their dedicated workspace listing.
  const { data: exportJobs } = useWorkspaceExportJobs(workspaceId)

  const prevStatusRef = useRef<Map<string, string> | null>(null)
  prevStatusRef.current ??= new Map()
  useEffect(() => {
    if (!tables) return
    const prevStatus = prevStatusRef.current ?? new Map<string, string>()
    const store = useImportTrayStore.getState()
    for (const table of tables) {
      const before = prevStatus.get(table.id)
      const now = table.jobStatus ?? 'none'
      if (before === 'running' && now === 'ready') {
        // Success toast only for imports — deletes reflect instantly in the grid and backfills
        // live-fill cells; announcing them would be noise.
        if (table.jobType === 'import') {
          const rows = (table.jobRowsProcessed ?? 0).toLocaleString()
          toast.success(`Imported ${rows} rows into "${table.name}"`)
          store.notify(table.id)
          setTimeout(() => useImportTrayStore.getState().dismiss(table.id), READY_AUTO_CLEAR_MS)
        }
      } else if (before === 'running' && now === 'failed') {
        // Surface every failure — e.g. a failed delete restores the optimistically-removed rows,
        // and a failed backfill leaves cells unfilled; the user should know why.
        const fallback =
          table.jobType === 'delete'
            ? `Delete failed for "${table.name}"`
            : table.jobType === 'backfill'
              ? `Column backfill failed for "${table.name}"`
              : `Import failed for "${table.name}"`
        toast.error(table.jobError || fallback)
        if (table.jobType === 'import') store.notify(table.id)
      }
      if (now !== 'running' && store.isCanceled(table.id)) store.consumeCanceled(table.id)
      prevStatus.set(table.id, now)
    }
  }, [tables])

  const uploads = useImportTrayStore(useShallow((s) => Object.values(s.uploads)))
  const notified = useImportTrayStore((s) => s.notified)
  const canceledIds = useImportTrayStore((s) => s.canceledIds)
  const dismissedIds = useImportTrayStore((s) => s.dismissedIds)

  return useMemo(() => {
    const rows: ImportRow[] = []
    const seen = new Set<string>()

    for (const table of tables ?? []) {
      if (scopeTableId && table.id !== scopeTableId) continue
      // Of the table-derived jobs, only imports render here: deletes reflect optimistically in
      // the grid and backfills live-fill cells via SSE. (Exports merge in below.)
      if (table.jobType !== 'import') continue
      if (table.jobStatus === 'running') {
        if (canceledIds[table.id]) continue
        rows.push({
          id: table.id,
          tableId: table.id,
          workspaceId: table.workspaceId,
          title: table.name,
          phase: 'importing',
          jobType: 'import',
          rowsProcessed: table.jobRowsProcessed ?? 0,
          jobId: table.jobId ?? undefined,
        })
        seen.add(table.id)
      } else if (
        (table.jobStatus === 'ready' || table.jobStatus === 'failed') &&
        notified[table.id]
      ) {
        rows.push({
          id: table.id,
          tableId: table.id,
          workspaceId: table.workspaceId,
          title: table.name,
          phase: table.jobStatus,
          jobType: 'import',
          rowsProcessed: table.jobRowsProcessed ?? 0,
          error: table.jobError ?? undefined,
        })
        seen.add(table.id)
      }
    }

    for (const upload of uploads) {
      if (upload.workspaceId !== workspaceId) continue
      if (scopeTableId && upload.uploadId !== scopeTableId) continue
      if (canceledIds[upload.uploadId] || seen.has(upload.uploadId)) continue
      rows.push({
        id: upload.uploadId,
        tableId: upload.uploadId,
        workspaceId: upload.workspaceId,
        title: upload.title,
        phase: 'importing',
        jobType: 'import',
        rowsProcessed: 0,
        percent: upload.percent,
      })
    }

    // Export rows: running ones always; terminal ready stays listed (re-downloadable) until the
    // server's visibility window lapses or the user dismisses it. Keyed by jobId.
    for (const job of exportJobs ?? []) {
      if (!workspaceId) break
      if (scopeTableId && job.tableId !== scopeTableId) continue
      if (job.status === 'canceled' || canceledIds[job.jobId] || dismissedIds[job.jobId]) continue
      if (job.status === 'running') {
        rows.push({
          id: job.jobId,
          tableId: job.tableId,
          workspaceId,
          title: job.tableName,
          phase: 'importing',
          jobType: 'export',
          rowsProcessed: job.rowsProcessed,
          jobId: job.jobId,
        })
      } else {
        rows.push({
          id: job.jobId,
          tableId: job.tableId,
          workspaceId,
          title: job.tableName,
          phase: job.status === 'ready' ? 'ready' : 'failed',
          jobType: 'export',
          rowsProcessed: job.rowsProcessed,
          jobId: job.jobId,
          hasResult: job.hasResult,
          error: job.error ?? undefined,
        })
      }
    }

    rows.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'importing' ? -1 : 1))
    return rows
  }, [tables, exportJobs, uploads, notified, canceledIds, dismissedIds, workspaceId, scopeTableId])
}

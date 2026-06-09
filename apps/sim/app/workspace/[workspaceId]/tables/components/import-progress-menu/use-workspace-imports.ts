'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/components/emcn'
import { useTablesList } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const READY_AUTO_CLEAR_MS = 6000
const POLL_INTERVAL_MS = 2000

export type ImportPhase = 'importing' | 'ready' | 'failed'

/** A row rendered in the import tray. Running rows come live from the table list; uploads are
 *  client-only until their server row exists. Delete jobs are intentionally excluded — the grid
 *  reflects a delete optimistically, so a progress row would be redundant. */
export interface ImportRow {
  id: string
  workspaceId: string
  title: string
  phase: ImportPhase
  rowsProcessed: number
  /** Upload byte percent (upload phase only). */
  percent?: number
  error?: string
  jobId?: string
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

  const prevStatus = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!tables) return
    const store = useImportTrayStore.getState()
    for (const table of tables) {
      const before = prevStatus.current.get(table.id)
      const now = table.jobStatus ?? 'none'
      if (before === 'running' && now === 'ready') {
        // Deletes are reflected instantly in the grid — no tray row, no success toast.
        if (table.jobType !== 'delete') {
          const rows = (table.jobRowsProcessed ?? 0).toLocaleString()
          toast.success(`Imported ${rows} rows into "${table.name}"`)
          store.notify(table.id)
          setTimeout(() => useImportTrayStore.getState().dismiss(table.id), READY_AUTO_CLEAR_MS)
        }
      } else if (before === 'running' && now === 'failed') {
        // Surface failures for both — a failed delete restores the optimistically-removed rows.
        const fallback =
          table.jobType === 'delete'
            ? `Delete failed for "${table.name}"`
            : `Import failed for "${table.name}"`
        toast.error(table.jobError || fallback)
        if (table.jobType !== 'delete') store.notify(table.id)
      }
      if (now !== 'running' && store.isCanceled(table.id)) store.consumeCanceled(table.id)
      prevStatus.current.set(table.id, now)
    }
  }, [tables])

  const uploads = useImportTrayStore(useShallow((s) => Object.values(s.uploads)))
  const notified = useImportTrayStore((s) => s.notified)
  const canceledIds = useImportTrayStore((s) => s.canceledIds)

  return useMemo(() => {
    const rows: ImportRow[] = []
    const seen = new Set<string>()

    for (const table of tables ?? []) {
      if (scopeTableId && table.id !== scopeTableId) continue
      // Delete jobs are reflected optimistically in the grid — they never render in the tray.
      if (table.jobType === 'delete') continue
      if (table.jobStatus === 'running') {
        if (canceledIds[table.id]) continue
        rows.push({
          id: table.id,
          workspaceId: table.workspaceId,
          title: table.name,
          phase: 'importing',
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
          workspaceId: table.workspaceId,
          title: table.name,
          phase: table.jobStatus,
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
        workspaceId: upload.workspaceId,
        title: upload.title,
        phase: 'importing',
        rowsProcessed: 0,
        percent: upload.percent,
      })
    }

    rows.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'importing' ? -1 : 1))
    return rows
  }, [tables, uploads, notified, canceledIds, workspaceId, scopeTableId])
}

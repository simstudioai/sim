'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/components/emcn'
import type { TableEventEntry } from '@/lib/table/events'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const logger = createLogger('useImportProgressTracker')

/** How long a completed import stays in the tray (showing `1/1`) before auto-clearing. */
const READY_AUTO_CLEAR_MS = 6000

/**
 * Subscribes to the table-events SSE stream for each actively-importing table in the
 * tray and drives the tray + completion toasts. Mounted by {@link ImportProgressMenu}
 * (which lives in every tables header), so the indicator stays live on the list view too
 * — not only on the table detail page where the grid's own event stream runs.
 *
 * Terminal handling: a `ready` import flips the count to `1/1`, fires the success toast,
 * then auto-clears after {@link READY_AUTO_CLEAR_MS} so completed imports don't pile up; a
 * `failed` one lingers as an error card until dismissed. This is the single place the
 * import toast fires, so the detail page's stream no longer toasts.
 */
export function useImportProgressTracker(): void {
  const importingIds = useImportTrayStore(
    useShallow((state) =>
      Object.values(state.entries)
        .filter((entry) => entry.phase === 'importing')
        .map((entry) => entry.tableId)
    )
  )

  useEffect(() => {
    if (importingIds.length === 0) return

    const sources = importingIds.map((tableId) => {
      const source = new EventSource(`/api/table/${tableId}/events/stream?from=0`)
      source.onmessage = (msg: MessageEvent<string>) => {
        try {
          const { event } = JSON.parse(msg.data) as TableEventEntry
          if (event?.kind !== 'import') return
          const tray = useImportTrayStore.getState()
          const existing = tray.entries[tableId]
          // The stream replays from the start, so the buffer can hold a *prior* import's events
          // for this table. Once we know this run's importId, ignore anything that doesn't match;
          // before we know it (brief optimistic window), don't trust a replayed terminal event.
          const lockedId = existing?.importId
          if (lockedId && event.importId !== lockedId) return
          const isTerminal =
            event.status === 'ready' || event.status === 'failed' || event.status === 'canceled'
          if (!lockedId && isTerminal) return

          const importId = lockedId ?? event.importId
          const title = existing?.title ?? 'table'
          const rows = event.progress ?? existing?.rowsProcessed ?? 0
          if (event.status === 'canceled') {
            // The user stopped it — just clear the tray entry (no toast, they initiated it).
            tray.dismiss(tableId)
            return
          }
          if (event.status === 'ready') {
            toast.success(`Imported ${rows.toLocaleString()} rows into "${title}"`)
            // Keep it briefly so the count reads `1/1`, then clear (if still ready).
            tray.upsert({
              tableId,
              workspaceId: existing?.workspaceId ?? '',
              title,
              importId,
              phase: 'ready',
            })
            setTimeout(() => {
              if (useImportTrayStore.getState().entries[tableId]?.phase === 'ready') {
                useImportTrayStore.getState().dismiss(tableId)
              }
            }, READY_AUTO_CLEAR_MS)
            return
          }
          if (event.status === 'failed') {
            toast.error(event.error || `Import failed for "${title}"`)
          }
          tray.upsert({
            tableId,
            workspaceId: existing?.workspaceId ?? '',
            title,
            importId,
            phase: event.status,
            rowsProcessed: rows,
            percent: event.percent,
            error: event.error ?? undefined,
          })
        } catch (err) {
          logger.warn('Failed to parse import event', { tableId, err })
        }
      }
      source.onerror = () => source.close()
      return source
    })

    return () => {
      for (const source of sources) source.close()
    }
  }, [importingIds])
}

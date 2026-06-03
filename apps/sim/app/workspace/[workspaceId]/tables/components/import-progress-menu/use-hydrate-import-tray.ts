'use client'

import { useEffect } from 'react'
import { useTablesList } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

/**
 * Re-seeds the in-memory import tray from server truth so the header indicator survives a
 * page refresh. The tray itself isn't persisted; the durable state lives on the table rows
 * (`importStatus` / `importRowsProcessed`), surfaced by {@link useTablesList}. Once an entry
 * is seeded, {@link useImportProgressTracker} opens the SSE stream and the worker's replayed
 * events restore the live `total` / percent.
 *
 * Reconcile rules (the query is staler — 30s — than the SSE feed, so it never clobbers live
 * progress):
 * - seed entries for `importing` tables that aren't tracked yet;
 * - self-heal: clear a tray entry the server now reports `ready` (the import finished while we
 *   weren't subscribed and the SSE `ready` was missed).
 *
 * It deliberately only acts on these two definitive server states. Entries whose table isn't in
 * the list yet (a just-kicked-off import the list hasn't refetched, or a client-optimistic entry
 * during upload) are left alone so the indicator doesn't flicker out from under an active import.
 */
export function useHydrateImportTray(workspaceId: string | undefined): void {
  const { data: tables } = useTablesList(workspaceId)

  useEffect(() => {
    if (!workspaceId || !tables) return
    const tray = useImportTrayStore.getState()

    for (const table of tables) {
      if (table.importStatus === 'importing') {
        if (tray.entries[table.id]) continue
        tray.upsert({
          tableId: table.id,
          workspaceId,
          title: table.name,
          phase: 'importing',
          rowsProcessed: table.importRowsProcessed ?? 0,
          error: table.importError ?? undefined,
        })
      } else if (table.importStatus === 'ready' && tray.entries[table.id]?.phase === 'importing') {
        // Finished while we weren't watching and we missed the SSE `ready`.
        tray.dismiss(table.id)
      }
    }
  }, [workspaceId, tables])
}

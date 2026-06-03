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
 * - self-heal a tracked `importing` entry when the server reports a terminal state we missed
 *   over SSE: `ready` → clear the spinner; `failed` → flip it to the failure card.
 *
 * Terminal reconciliation only touches entries we're *already* tracking as importing — a `failed`
 * table that isn't in the tray is never re-created, so a dismissed failure stays dismissed across
 * refreshes. Entries whose table isn't in the list yet (a just-kicked-off import the list hasn't
 * refetched, or a client-optimistic entry during upload) are left alone so the indicator doesn't
 * flicker out from under an active import.
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
          importId: table.importId ?? undefined,
          phase: 'importing',
          rowsProcessed: table.importRowsProcessed ?? 0,
          error: table.importError ?? undefined,
        })
      } else if (tray.entries[table.id]?.phase === 'importing') {
        // A tracked import finished while we weren't watching (missed SSE terminal event).
        // `ready` → clear the spinner; `failed` → surface the failure instead of spinning forever.
        if (table.importStatus === 'ready') {
          tray.dismiss(table.id)
        } else if (table.importStatus === 'failed') {
          tray.upsert({
            tableId: table.id,
            workspaceId,
            title: table.name,
            phase: 'failed',
            error: table.importError ?? undefined,
          })
        }
      }
    }
  }, [workspaceId, tables])
}

'use client'

import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ProgressItem,
} from '@/components/emcn'
import { Upload } from '@/components/emcn/icons'
import { cancelTableImport } from '@/hooks/queries/tables'
import { selectWorkspaceImports, useImportTrayStore } from '@/stores/table/import-tray/store'
import { getImportStage } from './import-stage'
import { useHydrateImportTray } from './use-hydrate-import-tray'
import { useImportProgressTracker } from './use-import-progress-tracker'

interface ImportProgressMenuProps {
  workspaceId: string | undefined
  /** When mounted inside a specific table's header, the indicator is scoped to that table. */
  tableId?: string
}

/**
 * Header affordance for background CSV imports: a clickable `{done}/{total}` count that opens a
 * dropdown of per-import progress rows. Renders nothing when there are no tracked imports. The
 * single import-progress surface for both the tables list and the in-table view.
 */
export function ImportProgressMenu({ workspaceId, tableId }: ImportProgressMenuProps) {
  // Re-seed the (in-memory) tray from server truth so the indicator survives a refresh,
  // then keep it live on every page by subscribing to each active import's event stream.
  useHydrateImportTray(workspaceId)
  useImportProgressTracker()

  // `selectWorkspaceImports` builds a fresh array each call; `useShallow` compares its
  // contents so a re-render is triggered only when the entries actually change (without it
  // the new reference loops forever).
  const allImports = useImportTrayStore(
    useShallow((state) => selectWorkspaceImports(state, workspaceId))
  )
  const dismiss = useImportTrayStore((state) => state.dismiss)
  const cancelEntry = useImportTrayStore((state) => state.cancel)
  const menuOpen = useImportTrayStore((state) => state.menuOpen)
  const setMenuOpen = useImportTrayStore((state) => state.setMenuOpen)

  // Inside a table, scope the indicator to that table's import only; on the list view show
  // every active import in the workspace.
  const imports = tableId ? allImports.filter((e) => e.tableId === tableId) : allImports

  if (imports.length === 0) return null

  const total = imports.length
  const done = imports.filter((e) => e.phase === 'ready').length

  const cancel = (entry: (typeof imports)[number]) => {
    // Clear it + flag canceled so an in-flight upload's callbacks don't re-create it.
    cancelEntry(entry.tableId)
    if (entry.importId) {
      // Worker already running — cancel it server-side now. (Otherwise the kickoff handler cancels
      // it once the importId is known; see the `consumeCanceled` branches.)
      void cancelTableImport(entry.workspaceId, entry.tableId, entry.importId).catch(() => {})
    }
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant='subtle' className='px-2 py-1 text-caption'>
          <Upload className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
          <span className='tabular-nums'>
            {done}/{total}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='min-w-[320px] max-w-[420px] gap-0 p-1'>
        {imports.map((entry) => {
          const stage = getImportStage(entry)
          return (
            <ProgressItem
              key={entry.tableId}
              status={stage.status}
              title={stage.title}
              meta={stage.meta}
              detail={stage.detail}
              onCancel={entry.phase === 'importing' ? () => cancel(entry) : undefined}
              onDismiss={stage.dismissible ? () => dismiss(entry.tableId) : undefined}
            />
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

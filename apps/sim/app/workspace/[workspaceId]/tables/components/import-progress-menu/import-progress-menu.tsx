'use client'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ProgressItem,
} from '@/components/emcn'
import { Upload } from '@/components/emcn/icons'
import { cancelTableImport } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'
import { getImportStage } from './import-stage'
import { type ImportRow, useWorkspaceImports } from './use-workspace-imports'

interface ImportProgressMenuProps {
  workspaceId: string | undefined
  /** When mounted inside a specific table's header, the indicator is scoped to that table. */
  tableId?: string
}

/**
 * Header affordance for background CSV imports: a clickable `{done}/{total}` count that opens a
 * dropdown of per-import progress rows. Renders nothing when there are no imports. The single
 * import-progress surface for both the tables list and the in-table view.
 */
export function ImportProgressMenu({ workspaceId, tableId }: ImportProgressMenuProps) {
  const imports = useWorkspaceImports(workspaceId, tableId)
  const dismiss = useImportTrayStore((state) => state.dismiss)
  const cancelId = useImportTrayStore((state) => state.cancel)
  const menuOpen = useImportTrayStore((state) => state.menuOpen)
  const setMenuOpen = useImportTrayStore((state) => state.setMenuOpen)

  if (imports.length === 0) return null

  const total = imports.length
  const done = imports.filter((e) => e.phase === 'ready').length

  const cancel = (row: ImportRow) => {
    cancelId(row.id)
    // Worker already running — cancel it server-side now. (An upload still mid-flight is canceled by
    // the kickoff handler once its importId is known; see the `consumeCanceled` branches.)
    if (row.importId) {
      void cancelTableImport(row.workspaceId, row.id, row.importId).catch(() => {})
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
        {imports.map((row) => {
          const stage = getImportStage(row)
          return (
            <ProgressItem
              key={row.id}
              status={stage.status}
              title={stage.title}
              meta={stage.meta}
              detail={stage.detail}
              onCancel={row.phase === 'importing' ? () => cancel(row) : undefined}
              onDismiss={stage.dismissible ? () => dismiss(row.id) : undefined}
            />
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

'use client'

import { createLogger } from '@sim/logger'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ProgressItem,
  toast,
} from '@/components/emcn'
import { CircleAlert, CircleCheck, Loader } from '@/components/emcn/icons'
import { cancelTableJob, downloadExportResult } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'
import { getImportStage } from './import-stage'
import { type ImportRow, useWorkspaceImports } from './use-workspace-imports'
import { useTranslations } from 'next-intl'

const logger = createLogger('ImportProgressMenu')

interface ImportProgressMenuProps {
  workspaceId: string | undefined
  /** When mounted inside a specific table's header, the indicator is scoped to that table. */
  tableId?: string
}

/**
 * Header affordance for background table jobs: a clickable `{done}/{total}` count that opens a
 * dropdown of per-job progress rows — CSV imports and exports (a ready export row carries a
 * Download action). Renders nothing when there are no jobs. The single job-progress surface for
 * both the tables list and the in-table view.
 */
export function ImportProgressMenu({ workspaceId, tableId }: ImportProgressMenuProps) {
  const t = useTranslations('auto')
  const imports = useWorkspaceImports(workspaceId, tableId)
  const dismiss = useImportTrayStore((state) => state.dismiss)
  const dismissJob = useImportTrayStore((state) => state.dismissJob)
  const cancelId = useImportTrayStore((state) => state.cancel)
  const menuOpen = useImportTrayStore((state) => state.menuOpen)
  const setMenuOpen = useImportTrayStore((state) => state.setMenuOpen)

  if (imports.length === 0) return null

  const total = imports.length
  const done = imports.filter((e) => e.phase === 'ready').length
  const anyRunning = imports.some((e) => e.phase === 'importing')
  const anyFailed = imports.some((e) => e.phase === 'failed')

  const cancel = (row: ImportRow) => {
    cancelId(row.id)
    // Worker already running — cancel it server-side now. (An upload still mid-flight is canceled by
    // the kickoff handler once its jobId is known; see the `consumeCanceled` branches.)
    if (row.jobId) {
      void cancelTableJob(row.workspaceId, row.tableId, row.jobId).catch(() => {})
    }
  }

  const download = (row: ImportRow) => {
    if (!row.jobId) return
    void downloadExportResult(row.workspaceId, row.tableId, row.jobId).catch((err) => {
      logger.error('Export download failed', { jobId: row.jobId, err })
      toast.error('Download failed — the export may have expired')
    })
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant='subtle' className='px-2 py-1 text-caption'>
          {/* Aggregate state, mirroring the row iconography: spinner while anything runs, then
              alert if any job failed, else a check. */}
          {anyRunning ? (
            <Loader animate className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
          ) : anyFailed ? (
            <CircleAlert className='mr-1.5 size-[14px] text-[var(--text-error)]' />
          ) : (
            <CircleCheck className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
          )}
          <span className='tabular-nums'>
            {done}/{total}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='min-w-[320px] max-w-[420px] gap-0 p-1'>
        {imports.map((row) => {
          const stage = getImportStage(row)
          const isReadyExport = row.jobType === 'export' && row.phase === 'ready' && row.hasResult
          return (
            <ProgressItem
              key={row.id}
              status={stage.status}
              title={stage.title}
              meta={stage.meta}
              detail={
                isReadyExport ? (
                  <button
                    type='button'
                    className='text-[var(--brand-primary)] hover-hover:underline'
                    onClick={() => download(row)}
                  >
                    {t('download')}
                  </button>
                ) : (
                  stage.detail
                )
              }
              onCancel={row.phase === 'importing' ? () => cancel(row) : undefined}
              onDismiss={
                stage.dismissible
                  ? () => (row.jobType === 'export' ? dismissJob(row.id) : dismiss(row.id))
                  : undefined
              }
            />
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

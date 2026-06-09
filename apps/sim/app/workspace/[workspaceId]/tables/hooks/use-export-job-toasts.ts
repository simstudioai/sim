'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { toast } from '@/components/emcn'
import {
  cancelTableJob,
  downloadExportResult,
  useWorkspaceExportJobs,
} from '@/hooks/queries/tables'

const logger = createLogger('useExportJobToasts')

/** How long the "Exported" success toast (with its Download action) stays up. */
const READY_TOAST_DURATION_MS = 60_000

/**
 * Surfaces export jobs as toasts, derived from the workspace export-jobs query rather than fired
 * imperatively — so the toast state always mirrors the job state:
 *
 *   - `running` → sticky info toast with a Cancel action (toasts carrying an action don't
 *     auto-dismiss).
 *   - `ready`   → success toast with a Download action.
 *   - `failed`  → error toast.
 *
 * Mounted only on the tables pages, and the toast stack clears on route change by design — so the
 * surface is tables-scoped. Navigating back while a job is still listed re-derives the toast from
 * the query; nothing persists across pages.
 */
export function useExportJobToasts(workspaceId: string | undefined): void {
  const { data: jobs } = useWorkspaceExportJobs(workspaceId)
  /** jobId → last status a toast was shown for, so each transition swaps the toast exactly once. */
  const trackedRef = useRef(new Map<string, { toastId: string; status: string }>())

  useEffect(() => {
    if (!jobs || !workspaceId) return
    const tracked = trackedRef.current

    for (const job of jobs) {
      const prev = tracked.get(job.jobId)
      if (prev?.status === job.status) continue
      if (prev) toast.dismiss(prev.toastId)

      if (job.status === 'running') {
        const toastId = toast({
          message: `Exporting "${job.tableName}"…`,
          description: 'The download will start when it finishes.',
          variant: 'info',
          action: {
            label: 'Cancel',
            onClick: () => {
              void cancelTableJob(workspaceId, job.tableId, job.jobId).catch(() => {})
            },
          },
        })
        tracked.set(job.jobId, { toastId, status: job.status })
      } else if (job.status === 'ready' && job.hasResult) {
        const toastId = toast.success(`Exported "${job.tableName}"`, {
          description: `${job.rowsProcessed.toLocaleString()} rows`,
          duration: READY_TOAST_DURATION_MS,
          action: {
            label: 'Download',
            onClick: () => {
              void downloadExportResult(workspaceId, job.tableId, job.jobId).catch((err) => {
                logger.error('Export download failed', { jobId: job.jobId, err })
                toast.error('Download failed — the export may have expired')
              })
            },
          },
        })
        tracked.set(job.jobId, { toastId, status: job.status })
      } else if (job.status === 'failed') {
        const toastId = toast.error(job.error || `Export failed for "${job.tableName}"`)
        tracked.set(job.jobId, { toastId, status: job.status })
      } else {
        // canceled (or ready with a missing file): nothing to show, but record the status so a
        // stale-listed job doesn't re-toast on every sync.
        tracked.set(job.jobId, { toastId: prev?.toastId ?? '', status: job.status })
      }
    }
  }, [jobs, workspaceId])
}

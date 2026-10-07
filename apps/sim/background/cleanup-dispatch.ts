import { task } from '@trigger.dev/sdk'
import { type CleanupJobType, dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

export interface CleanupDispatchPayload {
  jobType: CleanupJobType
}

/** Attempts per dispatch. A rerun only re-triggers chunks that delete already-expired data. */
export const CLEANUP_DISPATCH_MAX_ATTEMPTS = 3

/**
 * Resolves a retention job's workspace scope and fans out its per-chunk cleanup runs. The scan
 * covers every active workspace, so it runs here rather than inside the cron request. One
 * dispatch at a time per job type: the route keys runs by `concurrencyKey`.
 */
export const cleanupDispatchTask = task({
  id: 'cleanup-dispatch',
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: CLEANUP_DISPATCH_MAX_ATTEMPTS },
  run: ({ jobType }: CleanupDispatchPayload) => dispatchCleanupJobs(jobType),
})

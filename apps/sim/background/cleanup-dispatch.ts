import { task } from '@trigger.dev/sdk'
import { type CleanupJobType, dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

export interface CleanupDispatchPayload {
  jobType: CleanupJobType
}

/**
 * Resolves a retention job's workspace scope and fans out its per-chunk cleanup runs. The scan
 * covers every active workspace, so it runs here rather than inside the cron request.
 */
export const cleanupDispatchTask = task({
  id: 'cleanup-dispatch',
  retry: { maxAttempts: 1 },
  run: ({ jobType }: CleanupDispatchPayload) => dispatchCleanupJobs(jobType),
})

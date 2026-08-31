import { task } from '@trigger.dev/sdk'
import { FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS } from '@/lib/workspace-files/search/constants'
import { dispatchWorkspaceFileSearchIndexJobs } from '@/lib/workspace-files/search/dispatcher'

/**
 * Runs the bounded search-index control plane outside the cron request. Per-file parsing remains
 * isolated in `workspace-file-search-index`; this task only backfills, claims, and enqueues work.
 */
export const workspaceFileSearchDispatchTask = task({
  id: 'workspace-file-search-dispatch',
  machine: 'small-1x',
  maxDuration: FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS,
  retry: { maxAttempts: 3 },
  queue: {
    name: 'workspace-file-search-dispatch',
    concurrencyLimit: 1,
  },
  run: () => dispatchWorkspaceFileSearchIndexJobs(),
})

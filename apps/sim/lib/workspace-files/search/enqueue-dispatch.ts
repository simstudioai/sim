import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type ScheduledPassResult, startScheduledPass } from '@/lib/core/async-jobs/scheduled-pass'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import {
  FILE_SEARCH_DISPATCH_INTERVAL_MS,
  FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS,
} from '@/lib/workspace-files/search/constants'
import {
  dispatchWorkspaceFileSearchIndexJobs,
  hasWorkspaceFileSearchDispatchWork,
} from '@/lib/workspace-files/search/dispatcher'

const logger = createLogger('WorkspaceFileSearchDispatchEnqueue')

/**
 * Starts no dispatcher run when there is nothing to dispatch. A failed check starts one anyway, so
 * an unhealthy probe can delay indexing by at most the dispatcher's own failure, never strand it.
 */
async function hasDispatchWork(): Promise<boolean> {
  try {
    return await hasWorkspaceFileSearchDispatchWork(new Date())
  } catch (error) {
    logger.warn('Workspace file search dispatch work check failed; dispatching anyway', {
      error: getErrorMessage(error),
    })
    return true
  }
}

/**
 * Durably hands a dispatcher run to Trigger.dev and returns after acceptance. The inline branch is
 * development-only and detaches from the HTTP response because the local server is long-lived.
 */
export async function enqueueWorkspaceFileSearchDispatch(): Promise<ScheduledPassResult> {
  return startScheduledPass({
    due: await hasDispatchWork(),
    triggerAvailable: () => isTriggerDevEnabled,
    startInline: () =>
      runDetached('workspace-file-search-dispatch', dispatchWorkspaceFileSearchIndexJobs),
    trigger: {
      taskId: 'workspace-file-search-dispatch',
      intervalMs: FILE_SEARCH_DISPATCH_INTERVAL_MS,
      options: { maxDuration: FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS, ttl: '5m' },
    },
  })
}

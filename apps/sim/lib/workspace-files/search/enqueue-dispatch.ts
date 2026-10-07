import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
import type { workspaceFileSearchDispatchTask } from '@/background/workspace-file-search-dispatch'

const logger = createLogger('WorkspaceFileSearchDispatchEnqueue')

export type WorkspaceFileSearchDispatchEnqueueResult =
  | { triggered: true; backend: 'trigger-dev' | 'inline'; jobId: string | null }
  | { triggered: false; backend: null; jobId: null }

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
export async function enqueueWorkspaceFileSearchDispatch(): Promise<WorkspaceFileSearchDispatchEnqueueResult> {
  if (!(await hasDispatchWork())) {
    return { triggered: false, backend: null, jobId: null }
  }

  if (!isTriggerDevEnabled) {
    runDetached('workspace-file-search-dispatch', dispatchWorkspaceFileSearchIndexJobs)
    return { triggered: true, backend: 'inline', jobId: null }
  }

  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const scheduleWindow = Math.floor(Date.now() / FILE_SEARCH_DISPATCH_INTERVAL_MS)
  const handle = await tasks.trigger<typeof workspaceFileSearchDispatchTask>(
    'workspace-file-search-dispatch',
    undefined,
    {
      idempotencyKey: `workspace-file-search-dispatch:${scheduleWindow}`,
      idempotencyKeyTTL: '5m',
      maxDuration: FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS,
      region: await resolveTriggerRegion(),
      ttl: '5m',
    }
  )
  return { triggered: true, backend: 'trigger-dev', jobId: handle.id }
}

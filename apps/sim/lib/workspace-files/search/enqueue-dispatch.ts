import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import {
  FILE_SEARCH_DISPATCH_INTERVAL_MS,
  FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS,
} from '@/lib/workspace-files/search/constants'
import { dispatchWorkspaceFileSearchIndexJobs } from '@/lib/workspace-files/search/dispatcher'

export interface WorkspaceFileSearchDispatchEnqueueResult {
  backend: 'trigger-dev' | 'inline'
  jobId: string | null
}

/**
 * Durably hands a dispatcher run to Trigger.dev and returns after acceptance. The inline branch is
 * development-only and detaches from the HTTP response because the local server is long-lived.
 */
export async function enqueueWorkspaceFileSearchDispatch(): Promise<WorkspaceFileSearchDispatchEnqueueResult> {
  if (!isTriggerDevEnabled) {
    runDetached('workspace-file-search-dispatch', dispatchWorkspaceFileSearchIndexJobs)
    return { backend: 'inline', jobId: null }
  }

  const [{ tasks }, { workspaceFileSearchDispatchTask }, { resolveTriggerRegion }] =
    await Promise.all([
      import('@trigger.dev/sdk'),
      import('@/background/workspace-file-search-dispatch'),
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
  return { backend: 'trigger-dev', jobId: handle.id }
}

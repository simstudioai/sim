import { task } from '@trigger.dev/sdk'
import {
  FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
} from '@/lib/workspace-files/search/constants'
import {
  indexWorkspaceFileForSearch,
  markWorkspaceFileSearchIndexFailed,
  type WorkspaceFileSearchIndexPayload,
} from '@/lib/workspace-files/search/indexing'

/**
 * Builds one immutable workspace-file search revision. PostgreSQL owns the durable state; this
 * task only supplies isolated compute, retries, and a hard global execution cap.
 */
export const workspaceFileSearchIndexTask = task({
  id: 'workspace-file-search-index',
  machine: 'medium-1x',
  maxDuration: FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
  retry: { maxAttempts: 3 },
  queue: {
    name: 'workspace-file-search-index',
    concurrencyLimit: FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  },
  run: (payload: WorkspaceFileSearchIndexPayload, { signal }) =>
    indexWorkspaceFileForSearch(payload, signal),
  onFailure: async ({ payload }) => {
    await markWorkspaceFileSearchIndexFailed(payload)
  },
})

import { task } from '@trigger.dev/sdk'
import {
  FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS,
  FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
} from '@/lib/workspace-files/search/constants'
import {
  getWorkspaceFileSearchRetry,
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
  machine: 'medium-2x',
  maxDuration: FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
  /** The ceiling for capacity retries; `catchError` stops other failures sooner. */
  retry: { maxAttempts: FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS },
  queue: {
    name: 'workspace-file-search-index',
    concurrencyLimit: FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  },
  run: (payload: WorkspaceFileSearchIndexPayload, { signal }) =>
    indexWorkspaceFileForSearch(payload, signal),
  catchError: async ({ error, ctx }) => getWorkspaceFileSearchRetry(error, ctx.attempt.number),
  onFailure: async ({ payload }) => {
    await markWorkspaceFileSearchIndexFailed(payload)
  },
})

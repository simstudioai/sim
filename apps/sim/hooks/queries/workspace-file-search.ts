import { useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type SearchWorkspaceFileContentQuery,
  searchWorkspaceFileContentContract,
} from '@/lib/api/contracts/workspace-file-search'
import {
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/workspace-files/search/constants'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

/** Searches share the browser invalidation prefix so edits, moves, and deletion refresh matches. */
const workspaceFileSearchKeys = {
  all: workspaceFilesKeys.all,
  searches: (workspaceId: string) =>
    [...workspaceFilesKeys.workspaceLists(workspaceId), 'content-search'] as const,
  search: (workspaceId: string, query: SearchWorkspaceFileContentQuery) =>
    [...workspaceFileSearchKeys.searches(workspaceId), query] as const,
}

const WORKSPACE_FILE_SEARCH_STALE_TIME = 10 * 1000
const SEARCH_CACHE_TIME = 60 * 1000
const INDEX_POLL_INTERVAL = 5 * 1000
const MAX_INDEX_POLLS = 12

/** Searches indexed text without downloading source files or the workspace inventory. */
export function useWorkspaceFileContentSearch(
  workspaceId: string,
  query: string,
  folderPath?: string
) {
  const input = { query, folderPath, maxResults: FILE_SEARCH_MAX_RESULTS }
  const length = [...query].length
  return useQuery({
    queryKey: workspaceFileSearchKeys.search(workspaceId, input),
    queryFn: ({ signal }) =>
      requestJson(searchWorkspaceFileContentContract, {
        params: { id: workspaceId },
        query: input,
        signal,
      }),
    enabled:
      Boolean(workspaceId) &&
      length >= FILE_SEARCH_MIN_QUERY_LENGTH &&
      length <= FILE_SEARCH_MAX_QUERY_LENGTH,
    staleTime: WORKSPACE_FILE_SEARCH_STALE_TIME,
    gcTime: SEARCH_CACHE_TIME,
    retry: (failureCount, error) =>
      failureCount < 1 && (!isApiClientError(error) || error.status === 423 || error.status >= 500),
    refetchInterval: (search) =>
      search.state.status === 'success' &&
      (search.state.data?.indexStatus.pendingFiles ?? 0) > 0 &&
      search.state.dataUpdateCount <= MAX_INDEX_POLLS
        ? INDEX_POLL_INTERVAL
        : false,
    refetchIntervalInBackground: false,
  })
}

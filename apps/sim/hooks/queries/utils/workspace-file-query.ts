import { requestJson } from '@/lib/api/client/request'
import { listWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

export type WorkspaceFileQueryScope = 'active' | 'archived'

/**
 * Query key factories for workspace files
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string) => [...workspaceFilesKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, scope: WorkspaceFileQueryScope = 'active') =>
    [...workspaceFilesKeys.workspaceLists(workspaceId), scope] as const,
  records: () => [...workspaceFilesKeys.all, 'record'] as const,
  record: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.records(), workspaceId, fileId] as const,
  contents: () => [...workspaceFilesKeys.all, 'content'] as const,
  contentFile: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.contents(), workspaceId, fileId] as const,
  content: (
    workspaceId: string,
    fileId: string,
    mode: 'text' | 'raw' | 'binary' = 'text',
    storageKey?: string
  ) =>
    [
      ...workspaceFilesKeys.contentFile(workspaceId, fileId),
      mode,
      ...(storageKey ? [storageKey] : []),
    ] as const,
  storageInfo: () => [...workspaceFilesKeys.all, 'storageInfo'] as const,
  cloudConfigured: () => [...workspaceFilesKeys.all, 'cloudConfigured'] as const,
}

export const WORKSPACE_FILES_LIST_STALE_TIME = 30 * 1000
/**
 * Fetch workspace files from API
 */
export async function fetchWorkspaceFiles(
  workspaceId: string,
  scope: WorkspaceFileQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkspaceFileRecord[]> {
  const data = await requestJson(listWorkspaceFilesContract, {
    params: { id: workspaceId },
    query: { scope },
    signal,
  })
  return data.success ? data.files : []
}

/**
 * Shared options for the workspace-file list, so an imperative caller can
 * `fetchQuery` the same cache entry {@link useWorkspaceFiles} populates instead
 * of refetching by key and reading the result back out of the cache.
 */
export function getWorkspaceFilesQueryOptions(
  workspaceId: string,
  scope: WorkspaceFileQueryScope = 'active'
) {
  return {
    queryKey: workspaceFilesKeys.list(workspaceId, scope),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchWorkspaceFiles(workspaceId, scope, signal),
    staleTime: WORKSPACE_FILES_LIST_STALE_TIME, // 30 seconds - files can change frequently
  }
}

import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkspaceCsvPreviewContract,
  type WorkspaceCsvPreviewResponse,
} from '@/lib/api/contracts/workspace-file-table'

/**
 * Query keys for the streamed CSV file-viewer preview. `key` (storage object key) and
 * `version` (the record's `updatedAt`) are folded in so a re-upload or edit busts the cache.
 */
export const WORKSPACE_CSV_PREVIEW_STALE_TIME = 30 * 1000

export const workspaceFileTableKeys = {
  all: ['workspaceFileTable'] as const,
  previews: () => [...workspaceFileTableKeys.all, 'preview'] as const,
  preview: (workspaceId: string, fileId: string, key: string, version?: number) =>
    [...workspaceFileTableKeys.previews(), workspaceId, fileId, key, version ?? ''] as const,
}

async function fetchWorkspaceCsvPreview(
  workspaceId: string,
  fileId: string,
  key: string,
  version: number | undefined,
  signal?: AbortSignal
): Promise<WorkspaceCsvPreviewResponse> {
  return requestJson(getWorkspaceCsvPreviewContract, {
    params: { id: workspaceId, fileId },
    query: version != null ? { key, v: version } : { key },
    signal,
  })
}

/**
 * Fetches the first {@link CSV_PREVIEW_MAX_ROWS} rows of a CSV via the streaming preview route.
 * The server reads only that prefix from storage, so this is safe for arbitrarily large files.
 */
export function useWorkspaceCsvPreview(
  workspaceId: string,
  fileId: string,
  key: string,
  version?: number,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: workspaceFileTableKeys.preview(workspaceId, fileId, key, version),
    queryFn: ({ signal }) => fetchWorkspaceCsvPreview(workspaceId, fileId, key, version, signal),
    enabled: !!workspaceId && !!fileId && !!key && (options?.enabled ?? true),
    staleTime: WORKSPACE_CSV_PREVIEW_STALE_TIME,
  })
}

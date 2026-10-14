import { useQuery } from '@tanstack/react-query'
import { resolveFileQueryOwner } from '@/hooks/queries/utils/file-owner-query-adapters'
import { workspaceFileTableKeys } from '@/hooks/queries/utils/file-table-keys'
import { useFileContentSource } from '@/hooks/use-file-content-source'

export const WORKSPACE_CSV_PREVIEW_STALE_TIME = 30 * 1000

/**
 * Fetches the first {@link CSV_PREVIEW_MAX_ROWS} rows of a CSV via the streaming preview route.
 * The server reads only that prefix from storage, so this is safe for arbitrarily large files.
 */
export function useWorkspaceCsvPreview(
  workspaceId: string | undefined,
  fileId: string,
  key: string,
  version?: number,
  options?: { enabled?: boolean }
) {
  const source = useFileContentSource()
  const ownerQuery = resolveFileQueryOwner(source.owner, workspaceId)
  return useQuery({
    queryKey:
      ownerQuery?.adapter.csvKey(ownerQuery.id, fileId, key, version) ??
      workspaceFileTableKeys.preview('', fileId, key, version),
    queryFn: ({ signal }) => {
      if (!ownerQuery) throw new Error('File owner is required')
      return ownerQuery.adapter.readCsv(ownerQuery.id, fileId, key, version, signal)
    },
    enabled: Boolean(ownerQuery) && !!fileId && !!key && (options?.enabled ?? true),
    staleTime: WORKSPACE_CSV_PREVIEW_STALE_TIME,
  })
}

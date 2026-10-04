import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { RevertWorkspaceFileVersionBody } from '@/lib/api/contracts/workspace-file-versions'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { getFileBrowserOwnerAdapter } from '@/hooks/queries/utils/file-browser-owner-adapters'

const FILE_HISTORY_STALE_TIME = 30_000
export const fileHistoryKeys = {
  all: ['fileHistory'] as const,
  lists: () => [...fileHistoryKeys.all, 'list'] as const,
  owner: (owner: EditableFileOwner) =>
    [...fileHistoryKeys.lists(), owner.entityType, owner.entityId] as const,
  list: (owner: EditableFileOwner, fileId: string) =>
    [...fileHistoryKeys.owner(owner), fileId] as const,
}

export function useFileHistory(owner: EditableFileOwner, fileId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: fileHistoryKeys.list(owner, fileId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      getFileBrowserOwnerAdapter(owner).history(owner.entityId, fileId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: FILE_HISTORY_STALE_TIME,
    enabled: Boolean(fileId) && enabled,
    refetchOnMount: 'always',
  })
}

export function useRevertFileVersion(owner: EditableFileOwner, fileId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ version, ...body }: RevertWorkspaceFileVersionBody & { version: number }) =>
      getFileBrowserOwnerAdapter(owner).revert(owner.entityId, fileId, version, body),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: fileHistoryKeys.list(owner, fileId) }),
        getFileBrowserOwnerAdapter(owner).invalidate(client, owner.entityId, fileId),
      ])
    },
  })
}

export function useDownloadFileVersion(owner: EditableFileOwner, fileId: string) {
  return useMutation({
    mutationFn: (version: number) =>
      getFileBrowserOwnerAdapter(owner).downloadVersion(owner.entityId, fileId, version),
  })
}

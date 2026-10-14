import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type CopyFileItemsBody, copyFileItemsContract } from '@/lib/api/contracts/file-copy'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { getFileBrowserOwnerAdapter } from '@/hooks/queries/utils/file-browser-owner-adapters'

const FILE_DESTINATION_STALE_TIME = 30_000
export const fileCopyKeys = {
  all: ['fileCopy'] as const,
  destinations: () => [...fileCopyKeys.all, 'destination'] as const,
  destination: (owner: EditableFileOwner) =>
    [...fileCopyKeys.destinations(), owner.entityType, owner.entityId] as const,
}

export function useFileCopyDestination(owner: EditableFileOwner) {
  return useQuery({
    queryKey: fileCopyKeys.destination(owner),
    queryFn: ({ signal }) =>
      getFileBrowserOwnerAdapter(owner).destinationFolders(owner.entityId, signal),
    staleTime: FILE_DESTINATION_STALE_TIME,
    refetchOnMount: 'always',
  })
}

export function useCopyFileItems() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CopyFileItemsBody) =>
      requestJson(copyFileItemsContract, { body, query: {} }),
    onSuccess: async (_result, { destination }) => {
      await getFileBrowserOwnerAdapter(destination.owner).invalidate(
        client,
        destination.owner.entityId
      )
    },
  })
}

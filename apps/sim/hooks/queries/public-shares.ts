import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import {
  getFileShareContract,
  type ShareRecord,
  type UpsertFileShareBody,
  upsertFileShareContract,
} from '@/lib/api/contracts/public-shares'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

/**
 * Query key factories for public shares
 */
export const shareKeys = {
  all: ['publicShares'] as const,
  details: () => [...shareKeys.all, 'detail'] as const,
  detail: (workspaceId: string, fileId: string) =>
    [...shareKeys.details(), workspaceId, fileId] as const,
}

async function fetchFileShare(
  workspaceId: string,
  fileId: string,
  signal?: AbortSignal
): Promise<ShareRecord | null> {
  const data = await requestJson(getFileShareContract, {
    params: { id: workspaceId, fileId },
    signal,
  })
  return data.share
}

export function useFileShare(workspaceId: string, fileId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: shareKeys.detail(workspaceId, fileId),
    queryFn: ({ signal }) => fetchFileShare(workspaceId, fileId, signal),
    enabled: Boolean(workspaceId) && Boolean(fileId) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
  })
}

interface UpsertFileShareVariables extends UpsertFileShareBody {
  workspaceId: string
  fileId: string
}

export function useUpsertFileShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, fileId, isActive }: UpsertFileShareVariables) =>
      requestJson(upsertFileShareContract, {
        params: { id: workspaceId, fileId },
        body: { isActive },
      }),
    onSuccess: (data, { workspaceId, fileId, isActive }) => {
      queryClient.setQueryData(shareKeys.detail(workspaceId, fileId), data.share)
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
      if (!isActive) {
        toast.success('Sharing turned off')
        return
      }
      const { url } = data.share
      toast.success('Public link enabled', {
        description: url,
        action: {
          label: 'Copy link',
          onClick: () => {
            navigator.clipboard.writeText(url).then(
              () => toast.success('Link copied'),
              () => toast.error('Failed to copy link')
            )
          },
        },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

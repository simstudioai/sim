import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CustomBlock,
  deleteCustomBlockContract,
  listCustomBlocksContract,
  type PublishCustomBlockBody,
  publishCustomBlockContract,
  type UpdateCustomBlockBody,
  updateCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'

export const customBlockKeys = {
  all: ['custom-blocks'] as const,
  lists: () => [...customBlockKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...customBlockKeys.lists(), workspaceId ?? ''] as const,
}

interface CustomBlocksResult {
  enabled: boolean
  customBlocks: CustomBlock[]
}

async function fetchCustomBlocks(
  workspaceId: string,
  signal?: AbortSignal
): Promise<CustomBlocksResult> {
  return requestJson(listCustomBlocksContract, { query: { workspaceId }, signal })
}

function useCustomBlocksQuery<T>(
  workspaceId: string | undefined,
  select: (r: CustomBlocksResult) => T
) {
  return useQuery({
    queryKey: customBlockKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchCustomBlocks(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
    select,
  })
}

/** Org custom blocks (with live-derived input fields) available in this workspace. */
export function useCustomBlocks(workspaceId?: string) {
  return useCustomBlocksQuery(workspaceId, (r) => r.customBlocks)
}

/** Whether this workspace may publish/use custom blocks (feature flag + enterprise plan). */
export function useCanPublishCustomBlock(workspaceId?: string) {
  return useCustomBlocksQuery(workspaceId, (r) => r.enabled)
}

export function usePublishCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PublishCustomBlockBody) => requestJson(publishCustomBlockContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.list(workspaceId) })
    },
  })
}

export function useUpdateCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCustomBlockBody & { id: string }) =>
      requestJson(updateCustomBlockContract, { params: { id }, body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.list(workspaceId) })
    },
  })
}

export function useDeleteCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => requestJson(deleteCustomBlockContract, { params: { id } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.list(workspaceId) })
    },
  })
}

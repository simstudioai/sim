import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CustomBlock,
  type CustomBlockUsage,
  deleteCustomBlockContract,
  getCustomBlockUsagesContract,
  listCustomBlocksContract,
  type PublishCustomBlockBody,
  publishCustomBlockContract,
  type UpdateCustomBlockBody,
  updateCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'

export const CUSTOM_BLOCK_LIST_STALE_TIME = 60 * 1000
/** Short — the usage list is a pre-delete safety check and must stay fresh. */
export const CUSTOM_BLOCK_USAGES_STALE_TIME = 30 * 1000

export const customBlockKeys = {
  all: ['custom-blocks'] as const,
  lists: () => [...customBlockKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...customBlockKeys.lists(), workspaceId ?? ''] as const,
  usages: (id?: string) => [...customBlockKeys.all, 'usages', id ?? ''] as const,
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
    staleTime: CUSTOM_BLOCK_LIST_STALE_TIME,
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

async function fetchCustomBlockUsages(
  id: string,
  signal?: AbortSignal
): Promise<CustomBlockUsage[]> {
  const data = await requestJson(getCustomBlockUsagesContract, { params: { id }, signal })
  return data.usages
}

/** Workflows across the org that place this block (live editor state and/or active deployment). */
export function useCustomBlockUsages(blockId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: customBlockKeys.usages(blockId),
    queryFn: ({ signal }) => fetchCustomBlockUsages(blockId as string, signal),
    enabled: Boolean(blockId) && (options?.enabled ?? true),
    staleTime: CUSTOM_BLOCK_USAGES_STALE_TIME,
  })
}

export function usePublishCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PublishCustomBlockBody) => requestJson(publishCustomBlockContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.lists() })
    },
  })
}

export function useUpdateCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCustomBlockBody & { id: string }) =>
      requestJson(updateCustomBlockContract, { params: { id }, body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.lists() })
    },
  })
}

export function useDeleteCustomBlock(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => requestJson(deleteCustomBlockContract, { params: { id } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: customBlockKeys.lists() })
    },
  })
}

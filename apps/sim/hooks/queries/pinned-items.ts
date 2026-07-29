import { useMemo } from 'react'
import { generateId } from '@sim/utils/id'
import {
  keepPreviousData,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createPinnedItemContract,
  deletePinnedItemContract,
  listPinnedItemsContract,
  type PinnedItemApi,
  type PinnedResourceType,
} from '@/lib/api/contracts'

export const PINNED_ITEMS_STALE_TIME = 60 * 1000

export const pinnedItemKeys = {
  all: ['pinnedItems'] as const,
  lists: () => [...pinnedItemKeys.all, 'list'] as const,
  /** Prefix covering every per-resourceType list in a workspace — the invalidation target. */
  workspaceLists: (workspaceId?: string) => [...pinnedItemKeys.lists(), workspaceId ?? ''] as const,
  list: (workspaceId?: string, resourceType?: PinnedResourceType) =>
    [...pinnedItemKeys.workspaceLists(workspaceId), resourceType ?? ''] as const,
}

async function fetchPinnedItems(
  workspaceId: string,
  resourceType?: PinnedResourceType,
  signal?: AbortSignal
): Promise<PinnedItemApi[]> {
  const { pinnedItems } = await requestJson(listPinnedItemsContract, {
    query: { workspaceId, resourceType },
    signal,
  })
  return pinnedItems
}

export function usePinnedItems(workspaceId?: string, resourceType?: PinnedResourceType) {
  return useQuery({
    queryKey: pinnedItemKeys.list(workspaceId, resourceType),
    queryFn: ({ signal }) => fetchPinnedItems(workspaceId as string, resourceType, signal),
    enabled: Boolean(workspaceId),
    staleTime: PINNED_ITEMS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

const EMPTY_PINNED_IDS: ReadonlySet<string> = new Set()

/**
 * Pinned resourceIds for one resource type as a `Set`, so a list renders pin state
 * with an O(1) lookup per row instead of scanning the pinned array per row.
 */
export function usePinnedIds(
  workspaceId?: string,
  resourceType?: PinnedResourceType
): ReadonlySet<string> {
  const { data } = usePinnedItems(workspaceId, resourceType)
  return useMemo(
    () => (data ? new Set(data.map((item) => item.resourceId)) : EMPTY_PINNED_IDS),
    [data]
  )
}

interface PinItemVariables {
  workspaceId: string
  resourceType: PinnedResourceType
  resourceId: string
}

/**
 * Index of the `resourceType` segment within `pinnedItemKeys.list(...)`, derived from
 * the factory itself so it cannot drift if the key shape changes.
 */
const RESOURCE_TYPE_KEY_INDEX = pinnedItemKeys.workspaceLists().length

/**
 * A single pin/unpin is reflected in two cached lists: the `resourceType`-scoped one
 * and the unscoped workspace-wide one. Lists scoped to other resource types are left
 * untouched.
 */
function isAffectedListKey(queryKey: QueryKey, resourceType: PinnedResourceType): boolean {
  const scopedType = queryKey[RESOURCE_TYPE_KEY_INDEX]
  return scopedType === '' || scopedType === resourceType
}

function affectedListsFilter(workspaceId: string, resourceType: PinnedResourceType) {
  return {
    queryKey: pinnedItemKeys.workspaceLists(workspaceId),
    predicate: (query: { queryKey: QueryKey }) => isAffectedListKey(query.queryKey, resourceType),
  }
}

type PinnedListSnapshot = Array<[QueryKey, PinnedItemApi[] | undefined]>

/**
 * Shared optimistic-update plumbing for pin and unpin: cancel in-flight refetches,
 * snapshot every affected list for rollback, then apply `update` to each.
 */
function useOptimisticPinMutation<TData>(
  mutationFn: (variables: PinItemVariables) => Promise<TData>,
  update: (
    items: PinnedItemApi[] | undefined,
    variables: PinItemVariables
  ) => PinnedItemApi[] | undefined
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onMutate: async (variables: PinItemVariables) => {
      const filter = affectedListsFilter(variables.workspaceId, variables.resourceType)
      await queryClient.cancelQueries(filter)
      const snapshot: PinnedListSnapshot = queryClient.getQueriesData<PinnedItemApi[]>(filter)
      queryClient.setQueriesData<PinnedItemApi[]>(filter, (old) => update(old, variables))
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(queryKey, data)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
      })
    },
  })
}

export function usePinItem() {
  return useOptimisticPinMutation(
    async (variables) => {
      const { pinnedItem } = await requestJson(createPinnedItemContract, { body: variables })
      return pinnedItem
    },
    (old, variables) => {
      if (!old) return old
      if (old.some((item) => item.resourceId === variables.resourceId)) return old
      return [
        ...old,
        {
          id: generateId(),
          userId: '',
          workspaceId: variables.workspaceId,
          resourceType: variables.resourceType,
          resourceId: variables.resourceId,
          pinnedAt: new Date().toISOString(),
        },
      ]
    }
  )
}

export function useUnpinItem() {
  return useOptimisticPinMutation(
    ({ resourceType, resourceId }) =>
      requestJson(deletePinnedItemContract, { params: { resourceType, resourceId } }),
    (old, variables) => old?.filter((item) => item.resourceId !== variables.resourceId)
  )
}

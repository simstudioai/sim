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
  workspaceLists: (workspaceId: string | undefined) =>
    [...pinnedItemKeys.lists(), workspaceId ?? ''] as const,
  list: (workspaceId: string | undefined, resourceType?: PinnedResourceType) =>
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
    placeholderData: keepPreviousData,
    staleTime: PINNED_ITEMS_STALE_TIME,
  })
}

const EMPTY_PINNED_IDS: ReadonlySet<string> = new Set()

/**
 * Pinned resourceIds for one resource type, as a `Set` for O(1) per-row
 * lookups (never `.find()` per row — see `.claude/rules/sim-react-performance.md`).
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

interface UnpinItemVariables {
  workspaceId: string
  resourceType: PinnedResourceType
  resourceId: string
}

/**
 * Matches the unscoped `usePinnedItems(workspaceId)` list and the
 * `resourceType`-scoped list for `resourceType` — the two caches a single
 * pin/unpin can appear in — while leaving lists scoped to other resource
 * types untouched.
 */
function isAffectedPinnedListKey(queryKey: QueryKey, resourceType: PinnedResourceType): boolean {
  const scopedType = queryKey[3]
  return scopedType === '' || scopedType === resourceType
}

/**
 * Snapshots every cached pinned-items list that a pin/unpin of `resourceType`
 * can affect (the `resourceType`-scoped list and the unscoped
 * `usePinnedItems(workspaceId)` list share the same `workspaceLists` prefix),
 * so the optimistic update can later be rolled back.
 */
function snapshotPinnedListQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  resourceType: PinnedResourceType
): Array<[QueryKey, PinnedItemApi[] | undefined]> {
  return queryClient.getQueriesData<PinnedItemApi[]>({
    queryKey: pinnedItemKeys.workspaceLists(workspaceId),
    predicate: (query) => isAffectedPinnedListKey(query.queryKey, resourceType),
  })
}

function restorePinnedListQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshot: Array<[QueryKey, PinnedItemApi[] | undefined]>
): void {
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data)
  }
}

/**
 * Pins or unpins a resource with an optimistic update, following the same
 * `onMutate`/`onError`/`onSettled` pattern as `useSetMothershipChatPinned`.
 * Applies the optimistic change across every cached pinned-items list for
 * the workspace, since a single pin/unpin can be reflected in both the
 * unscoped list and a `resourceType`-scoped list simultaneously.
 */
export function usePinItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: PinItemVariables) => {
      const { pinnedItem } = await requestJson(createPinnedItemContract, { body: variables })
      return pinnedItem
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
      })

      const previousQueries = snapshotPinnedListQueries(
        queryClient,
        variables.workspaceId,
        variables.resourceType
      )

      const optimisticItem: PinnedItemApi = {
        id: generateId(),
        userId: '',
        workspaceId: variables.workspaceId,
        resourceType: variables.resourceType,
        resourceId: variables.resourceId,
        pinnedAt: new Date().toISOString(),
      }

      queryClient.setQueriesData<PinnedItemApi[]>(
        {
          queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
          predicate: (query) => isAffectedPinnedListKey(query.queryKey, variables.resourceType),
        },
        (old) => {
          if (!old) return old
          if (old.some((item) => item.resourceId === variables.resourceId)) return old
          return [...old, optimisticItem]
        }
      )

      return { previousQueries }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousQueries) {
        restorePinnedListQueries(queryClient, context.previousQueries)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
      })
    },
  })
}

export function useUnpinItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ resourceType, resourceId }: UnpinItemVariables) => {
      return requestJson(deletePinnedItemContract, { params: { resourceType, resourceId } })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
      })

      const previousQueries = snapshotPinnedListQueries(
        queryClient,
        variables.workspaceId,
        variables.resourceType
      )

      queryClient.setQueriesData<PinnedItemApi[]>(
        {
          queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
          predicate: (query) => isAffectedPinnedListKey(query.queryKey, variables.resourceType),
        },
        (old) => old?.filter((item) => item.resourceId !== variables.resourceId)
      )

      return { previousQueries }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousQueries) {
        restorePinnedListQueries(queryClient, context.previousQueries)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: pinnedItemKeys.workspaceLists(variables.workspaceId),
      })
    },
  })
}

/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryClient, cacheStore } = vi.hoisted(() => {
  const cache = new Map<string, unknown>()
  return {
    cacheStore: cache,
    queryClient: {
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn((key: readonly unknown[]) => cache.get(JSON.stringify(key))),
      setQueryData: vi.fn((key: readonly unknown[], updater: unknown) => {
        const k = JSON.stringify(key)
        const prev = cache.get(k)
        const next =
          typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater
        cache.set(k, next)
        return next
      }),
      getQueriesData: vi.fn(
        (opts: {
          queryKey: readonly unknown[]
          predicate?: (query: { queryKey: readonly unknown[] }) => boolean
        }) => {
          const prefix = JSON.stringify(opts.queryKey).slice(0, -1)
          return [...cache.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => [JSON.parse(k), v] as [readonly unknown[], unknown])
            .filter(([key]) => (opts.predicate ? opts.predicate({ queryKey: key }) : true))
        }
      ),
      setQueriesData: vi.fn(
        (
          opts: {
            queryKey: readonly unknown[]
            predicate?: (query: { queryKey: readonly unknown[] }) => boolean
          },
          updater: unknown
        ) => {
          const prefix = JSON.stringify(opts.queryKey).slice(0, -1)
          for (const [k, v] of [...cache.entries()]) {
            if (!k.startsWith(prefix)) continue
            const key = JSON.parse(k)
            if (opts.predicate && !opts.predicate({ queryKey: key })) continue
            const next =
              typeof updater === 'function' ? (updater as (p: unknown) => unknown)(v) : updater
            cache.set(k, next)
          }
        }
      ),
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: vi.fn(),
}))

vi.mock('@/lib/api/contracts', () => ({
  createPinnedItemContract: {},
  deletePinnedItemContract: {},
  listPinnedItemsContract: {},
}))

import { pinnedItemKeys, usePinItem, useUnpinItem } from '@/hooks/queries/pinned-items'

const WORKSPACE_ID = 'ws-1'

function setCache(key: readonly unknown[], value: unknown) {
  cacheStore.set(JSON.stringify(key), value)
}

function getCache<T>(key: readonly unknown[]): T | undefined {
  return cacheStore.get(JSON.stringify(key)) as T | undefined
}

beforeEach(() => {
  cacheStore.clear()
  vi.clearAllMocks()
})

describe('usePinItem optimistic update', () => {
  it('adds the optimistic pin to both the unscoped and matching resourceType-scoped lists, but leaves an unrelated resourceType list untouched', async () => {
    setCache(pinnedItemKeys.list(WORKSPACE_ID), [])
    setCache(pinnedItemKeys.list(WORKSPACE_ID, 'workflow'), [])
    const otherTypeList = [
      {
        id: 'pinned-existing',
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        resourceType: 'folder',
        resourceId: 'folder-1',
        pinnedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    setCache(pinnedItemKeys.list(WORKSPACE_ID, 'folder'), otherTypeList)

    const mutation = usePinItem()
    await mutation.onMutate?.({
      workspaceId: WORKSPACE_ID,
      resourceType: 'workflow',
      resourceId: 'workflow-1',
    })

    const unscoped = getCache<Array<{ resourceId: string }>>(pinnedItemKeys.list(WORKSPACE_ID))
    const workflowScoped = getCache<Array<{ resourceId: string }>>(
      pinnedItemKeys.list(WORKSPACE_ID, 'workflow')
    )
    const folderScoped = getCache<Array<{ resourceId: string }>>(
      pinnedItemKeys.list(WORKSPACE_ID, 'folder')
    )

    expect(unscoped?.map((i) => i.resourceId)).toEqual(['workflow-1'])
    expect(workflowScoped?.map((i) => i.resourceId)).toEqual(['workflow-1'])
    expect(folderScoped).toEqual(otherTypeList)
  })

  it('rolls back every affected cached list on error', async () => {
    const originalUnscoped = [
      {
        id: 'pinned-a',
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        resourceType: 'workflow',
        resourceId: 'workflow-a',
        pinnedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    setCache(pinnedItemKeys.list(WORKSPACE_ID), originalUnscoped)
    setCache(pinnedItemKeys.list(WORKSPACE_ID, 'workflow'), originalUnscoped)

    const mutation = usePinItem()
    const context = await mutation.onMutate?.({
      workspaceId: WORKSPACE_ID,
      resourceType: 'workflow',
      resourceId: 'workflow-1',
    })

    expect(getCache(pinnedItemKeys.list(WORKSPACE_ID))).not.toEqual(originalUnscoped)

    mutation.onError?.(
      new Error('failed'),
      {
        workspaceId: WORKSPACE_ID,
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      },
      context
    )

    expect(getCache(pinnedItemKeys.list(WORKSPACE_ID))).toEqual(originalUnscoped)
    expect(getCache(pinnedItemKeys.list(WORKSPACE_ID, 'workflow'))).toEqual(originalUnscoped)
  })
})

describe('useUnpinItem optimistic update', () => {
  it('removes the pin from both the unscoped and matching resourceType-scoped lists', async () => {
    const items = [
      {
        id: 'pinned-1',
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        resourceType: 'workflow',
        resourceId: 'workflow-1',
        pinnedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'pinned-2',
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        resourceType: 'workflow',
        resourceId: 'workflow-2',
        pinnedAt: '2024-01-02T00:00:00.000Z',
      },
    ]
    setCache(pinnedItemKeys.list(WORKSPACE_ID), items)
    setCache(pinnedItemKeys.list(WORKSPACE_ID, 'workflow'), items)

    const mutation = useUnpinItem()
    await mutation.onMutate?.({
      workspaceId: WORKSPACE_ID,
      resourceType: 'workflow',
      resourceId: 'workflow-1',
    })

    const unscoped = getCache<Array<{ resourceId: string }>>(pinnedItemKeys.list(WORKSPACE_ID))
    const workflowScoped = getCache<Array<{ resourceId: string }>>(
      pinnedItemKeys.list(WORKSPACE_ID, 'workflow')
    )

    expect(unscoped?.map((i) => i.resourceId)).toEqual(['workflow-2'])
    expect(workflowScoped?.map((i) => i.resourceId)).toEqual(['workflow-2'])
  })
})

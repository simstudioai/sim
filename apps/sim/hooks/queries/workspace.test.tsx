/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { ApiClientError } from '@/lib/api/client/errors'
import { createPinnedItemContract, deletePinnedItemContract } from '@/lib/api/contracts'
import { useToggleWorkspacePin, workspaceKeys } from '@/hooks/queries/workspace'

/** Trees rendered by a test, torn down in afterEach so observers do not leak across tests. */
const mountedRoots: Root[] = []

function renderHookWithClient<T>(useHook: () => T): {
  getResult: () => T
  queryClient: QueryClient
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  mountedRoots.push(root)
  let result: T | undefined

  function Probe() {
    result = useHook()
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    queryClient,
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

function seedList(queryClient: QueryClient, pinnedWorkspaceIds: string[]) {
  queryClient.setQueryData(workspaceKeys.list('active'), {
    workspaces: [],
    lastActiveWorkspaceId: null,
    pinnedWorkspaceIds,
    creationPolicy: null,
  })
}

function readPins(queryClient: QueryClient): string[] | undefined {
  return queryClient.getQueryData<{ pinnedWorkspaceIds: string[] }>(workspaceKeys.list('active'))
    ?.pinnedWorkspaceIds
}

function apiError(status: number) {
  return new ApiClientError({ status, message: `status ${status}`, body: {} })
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useToggleWorkspacePin', () => {
  it('pins by creating a row addressed to the workspace itself', async () => {
    mockRequestJson.mockResolvedValue({ pinnedItem: {} })
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
    })
    await flush()

    expect(mockRequestJson).toHaveBeenCalledWith(createPinnedItemContract, {
      body: { workspaceId: 'ws-a', resourceType: 'workspace', resourceId: 'ws-a' },
    })
  })

  it('unpins by deleting that row', async () => {
    mockRequestJson.mockResolvedValue({ success: true })
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, ['ws-a'])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: false })
    })
    await flush()

    expect(mockRequestJson).toHaveBeenCalledWith(deletePinnedItemContract, {
      params: { resourceType: 'workspace', resourceId: 'ws-a' },
    })
    expect(readPins(queryClient)).toEqual([])
  })

  /**
   * Pin then unpin the same workspace race on the same row: an unpin that overtook
   * its pin would delete nothing and leave the workspace pinned. The mutation scope
   * must hold the second request until the first resolves.
   */
  it('serializes toggles of the same workspace so the last one wins', async () => {
    const resolvers: Array<() => void> = []
    mockRequestJson.mockImplementation(
      () => new Promise((resolve) => resolvers.push(() => resolve({ pinnedItem: {} })))
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
      getResult().mutate({ workspaceId: 'ws-a', pinned: false })
    })
    await flush()

    // The unpin must not be on the wire while the pin is still outstanding.
    expect(mockRequestJson).toHaveBeenCalledOnce()
    expect(mockRequestJson.mock.calls[0][0]).toBe(createPinnedItemContract)
    // Optimistic state already reflects the user's last click.
    expect(readPins(queryClient)).toEqual([])

    act(() => resolvers[0]())
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson.mock.calls[1][0]).toBe(deletePinnedItemContract)
    expect(readPins(queryClient)).toEqual([])
  })

  /**
   * The writes are serialized, so an earlier toggle settles while a later one is
   * still queued. Refetching there would render the server's intermediate state and
   * bounce the row out of the pinned group and back.
   */
  it('reconciles only once no toggle is still queued', async () => {
    const resolvers: Array<() => void> = []
    mockRequestJson.mockImplementation(
      () => new Promise((resolve) => resolvers.push(() => resolve({ pinnedItem: {} })))
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
      getResult().mutate({ workspaceId: 'ws-a', pinned: false })
    })
    await flush()

    act(() => resolvers[0]())
    await flush()

    // The unpin is now in flight; reconciling here would refetch the pinned state.
    expect(invalidateSpy).not.toHaveBeenCalled()

    act(() => resolvers[1]())
    await flush()

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workspaceKeys.lists() })
  })

  /** Both duplicate-click outcomes mean the row is already in the requested end state. */
  it.each([
    ['pin', true, 409],
    ['unpin', false, 404],
  ])('treats a duplicate %s (%s) as success', async (_label, pinned, status) => {
    mockRequestJson.mockRejectedValue(apiError(status as number))
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, pinned ? [] : ['ws-a'])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: pinned as boolean })
    })
    await flush()

    expect(getResult().isError).toBe(false)
    expect(readPins(queryClient)).toEqual(pinned ? ['ws-a'] : [])
  })

  it('rolls the optimistic pin back when the write fails', async () => {
    mockRequestJson.mockRejectedValue(apiError(500))
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
    })
    await flush()

    expect(readPins(queryClient)).toEqual([])
  })

  /**
   * The rollback undoes its own toggle rather than restoring a snapshot, so a
   * concurrent toggle's optimistic state survives a sibling's failure.
   */
  it('does not drop a concurrent toggle when one fails', async () => {
    mockRequestJson.mockImplementation((contract: unknown) =>
      contract === createPinnedItemContract && mockRequestJson.mock.calls.length === 1
        ? Promise.reject(apiError(500))
        : Promise.resolve({ pinnedItem: {} })
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
      getResult().mutate({ workspaceId: 'ws-b', pinned: true })
    })
    await flush()

    expect(readPins(queryClient)).toEqual(['ws-b'])
  })
})

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
   * Two rapid toggles write different rows, so neither can overwrite the other and
   * both survive regardless of the order the requests land in.
   */
  it('keeps both pins when two toggles overlap', async () => {
    const resolvers: Array<() => void> = []
    mockRequestJson.mockImplementation(
      () => new Promise((resolve) => resolvers.push(() => resolve({ pinnedItem: {} })))
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
      getResult().mutate({ workspaceId: 'ws-b', pinned: true })
    })
    await flush()

    expect(readPins(queryClient)).toEqual(['ws-a', 'ws-b'])

    // Resolve out of order — the older request landing last must not undo the newer.
    act(() => {
      resolvers[1]()
      resolvers[0]()
    })
    await flush()

    const bodies = mockRequestJson.mock.calls.map((call) => call[1].body.resourceId)
    expect(bodies).toEqual(['ws-a', 'ws-b'])
    expect(readPins(queryClient)).toEqual(['ws-a', 'ws-b'])
  })

  /** Re-pinning an already-pinned workspace is the desired end state, not a failure. */
  it('treats a 409 from a duplicate pin as success', async () => {
    mockRequestJson.mockRejectedValue(
      new ApiClientError({ status: 409, message: 'This item is already pinned', body: {} })
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
    })
    await flush()

    expect(getResult().isError).toBe(false)
    expect(readPins(queryClient)).toEqual(['ws-a'])
  })

  it('rolls the optimistic pin back when the write fails', async () => {
    mockRequestJson.mockRejectedValue(
      new ApiClientError({ status: 500, message: 'boom', body: {} })
    )
    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    seedList(queryClient, [])

    act(() => {
      getResult().mutate({ workspaceId: 'ws-a', pinned: true })
    })
    await flush()

    expect(readPins(queryClient)).toEqual([])
  })
})

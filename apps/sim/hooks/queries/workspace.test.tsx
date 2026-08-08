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

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useToggleWorkspacePin', () => {
  /**
   * Each request carries the whole pin list, so overlapping writes that the network
   * delivers out of order would let the earlier click win. The hook chains them, so
   * the second request must not be issued until the first has resolved.
   */
  it('serializes overlapping writes so the last click is what persists', async () => {
    const resolvers: Array<() => void> = []
    mockRequestJson.mockImplementation(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolvers.push(() => resolve({ success: true }))
        })
    )

    const { getResult } = renderHookWithClient(() => useToggleWorkspacePin())

    act(() => {
      getResult().mutate({ pinnedWorkspaceIds: ['ws-a'] })
      getResult().mutate({ pinnedWorkspaceIds: ['ws-a', 'ws-b'] })
    })
    await flush()

    // Only the first write is on the wire; the second is queued behind it.
    expect(mockRequestJson).toHaveBeenCalledOnce()
    expect(mockRequestJson.mock.calls[0][1]).toMatchObject({
      body: { pinnedWorkspaceIds: ['ws-a'] },
    })

    act(() => resolvers[0]())
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson.mock.calls[1][1]).toMatchObject({
      body: { pinnedWorkspaceIds: ['ws-a', 'ws-b'] },
    })
  })

  /**
   * Refetching between two queued writes would render the server's pre-second-write
   * state and visibly bounce the row out of the pinned group and back.
   */
  it('reconciles only after the last queued write settles', async () => {
    const resolvers: Array<() => void> = []
    mockRequestJson.mockImplementation(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolvers.push(() => resolve({ success: true }))
        })
    )

    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    act(() => {
      getResult().mutate({ pinnedWorkspaceIds: ['ws-a'] })
      getResult().mutate({ pinnedWorkspaceIds: ['ws-a', 'ws-b'] })
    })
    await flush()

    act(() => resolvers[0]())
    await flush()

    // First write settled, second still outstanding — nothing reconciled yet.
    expect(invalidateSpy).not.toHaveBeenCalled()

    act(() => resolvers[1]())
    await flush()

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workspaceKeys.lists() })
  })

  it('applies the pin optimistically before the request resolves', async () => {
    mockRequestJson.mockImplementation(() => new Promise<{ success: true }>(() => {}))

    const { getResult, queryClient } = renderHookWithClient(() => useToggleWorkspacePin())
    queryClient.setQueryData(workspaceKeys.list('active'), {
      workspaces: [],
      lastActiveWorkspaceId: null,
      pinnedWorkspaceIds: [],
      creationPolicy: null,
    })

    act(() => {
      getResult().mutate({ pinnedWorkspaceIds: ['ws-a'] })
    })
    await flush()

    expect(
      queryClient.getQueryData<{ pinnedWorkspaceIds: string[] }>(workspaceKeys.list('active'))
        ?.pinnedWorkspaceIds
    ).toEqual(['ws-a'])
  })
})

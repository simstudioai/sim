/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { ApiClientError } from '@/lib/api/client/errors'
import {
  createPinnedItemContract,
  deletePinnedItemContract,
  recordWorkspaceVisitContract,
} from '@/lib/api/contracts'
import {
  useRecordWorkspaceVisit,
  useToggleWorkspacePin,
  useWorkspacePermissionsQuery,
  workspaceKeys,
} from '@/hooks/queries/workspace'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

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

describe('useWorkspacePermissionsQuery', () => {
  it('does not retain admin access while a different workspace loads', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    mountedRoots.push(root)

    queryClient.setQueryData(workspaceKeys.permissions('ws-a'), {
      users: [],
      total: 0,
      viewer: { userId: 'user-1', isAdmin: true, permissionType: 'admin' },
    })
    mockRequestJson.mockReturnValueOnce(new Promise<never>(() => {}))

    function Probe({ workspaceId }: { workspaceId: string }) {
      const { data } = useWorkspacePermissionsQuery(workspaceId)
      return <span>{data ? (data.viewer?.isAdmin ? 'admin' : 'member') : 'loading'}</span>
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe workspaceId='ws-a' />
        </QueryClientProvider>
      )
    })
    expect(container.textContent).toBe('admin')

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe workspaceId='ws-b' />
        </QueryClientProvider>
      )
    })

    expect(container.textContent).toBe('loading')
  })
})

describe('useToggleWorkspacePin', () => {
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

describe('useRecordWorkspaceVisit', () => {
  function seedWorkspaces(queryClient: QueryClient, ids: string[]) {
    queryClient.setQueryData(workspaceKeys.list('active'), {
      workspaces: ids.map((id) => ({ id })),
      lastActiveWorkspaceId: ids[0] ?? null,
      pinnedWorkspaceIds: [],
      creationPolicy: null,
    })
  }

  it('sends visits one at a time, in the order they happened', async () => {
    let finishFirst: (value: { success: true }) => void = () => {}
    mockRequestJson
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({ success: true })
    const { getResult, queryClient } = renderHookWithClient(() => useRecordWorkspaceVisit())
    seedWorkspaces(queryClient, ['ws-a', 'ws-b', 'ws-c'])

    act(() => {
      getResult().mutate('ws-b')
      getResult().mutate('ws-c')
    })
    await flush()
    expect(mockRequestJson).toHaveBeenCalledTimes(1)

    finishFirst({ success: true })
    await flush()
    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson).toHaveBeenLastCalledWith(recordWorkspaceVisitContract, {
      params: { id: 'ws-c' },
    })
  })
})

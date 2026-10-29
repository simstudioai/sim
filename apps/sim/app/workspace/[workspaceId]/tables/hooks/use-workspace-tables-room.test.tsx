/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseSocket } = vi.hoisted(() => ({ mockUseSocket: vi.fn() }))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: () => mockUseSocket(),
}))

import { INVALIDATION_COALESCE_MS } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { useWorkspaceTablesRoom } from '@/app/workspace/[workspaceId]/tables/hooks/use-workspace-tables-room'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

function fakeSocket() {
  return { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}

let socket: ReturnType<typeof fakeSocket>
let root: Root | null = null

function broadcast(workspaceId: string) {
  for (const [name, handler] of socket.on.mock.calls) {
    if (name === 'workspace-tables-changed') handler({ workspaceId })
  }
}

describe('useWorkspaceTablesRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    socket = fakeSocket()
    mockUseSocket.mockImplementation(() => ({ socket }))
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    vi.useRealTimers()
  })

  /*
   * The callback used to fire both invalidations and return nothing, so the room's delivery never
   * waited: a broadcast arriving while the list refetch was still loading invalidated it again,
   * which cancels and restarts the in-flight fetch. Under a burst of table writes a slow list never
   * finished loading.
   */
  it('does not restart a list refetch still in flight when the next broadcast arrives', async () => {
    const pending: Array<() => void> = []
    const fetchList = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          pending.push(() => resolve([]))
        })
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData([...tableKeys.lists(), 'ws-1'], [])

    function Probe() {
      useQuery({
        queryKey: [...tableKeys.lists(), 'ws-1'],
        queryFn: fetchList,
        staleTime: Number.POSITIVE_INFINITY,
      })
      useWorkspaceTablesRoom('ws-1')
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    )

    broadcast('ws-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchList).toHaveBeenCalledTimes(1)

    broadcast('ws-1')
    await vi.advanceTimersByTimeAsync(5 * INVALIDATION_COALESCE_MS)
    expect(fetchList).toHaveBeenCalledTimes(1)

    for (const resolve of pending.splice(0)) resolve()
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS)
    expect(fetchList).toHaveBeenCalledTimes(2)
  })
})

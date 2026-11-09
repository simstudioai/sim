/**
 * @vitest-environment jsdom
 *
 * The workspace list orders by the viewer's visits, so opening a workspace must record one. Failure
 * modes: no visit at all, a visit sent before the session is known, a switch that records nothing,
 * and a cached list that keeps the old order until a refetch.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceKeys } from '@/hooks/queries/utils/workspace-keys'

vi.mock('@/lib/auth/client', () => authClientMock)

import { WorkspaceVisit } from '@/platform/lib/data/workspace-visit'

const { mockUseSession } = authClientMockFns

let queryClient: QueryClient
let root: Root
let visits: string[]

function render(workspaceId: string) {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceVisit workspaceId={workspaceId} />
      </QueryClientProvider>
    )
  )
}

function signIn() {
  mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } }, isPending: false })
}

describe('recording workspace visits', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    visits = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'POST' && url.endsWith('/visit')) visits.push(url)
        return Response.json({ success: true })
      })
    )
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(document.createElement('div'))
  })

  afterEach(() => {
    act(() => root.unmount())
    mockUseSession.mockReset()
  })

  it('waits for the session before recording a visit', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    render('ws-1')
    await act(flushMacrotask)
    expect(visits).toEqual([])

    signIn()
    render('ws-1')
    await act(flushMacrotask)
    expect(visits).toEqual([expect.stringContaining('/api/workspaces/ws-1/visit')])
  })

  it('records the newly opened workspace and moves it to the front of the cached list', async () => {
    signIn()
    queryClient.setQueryData(workspaceKeys.list('active'), {
      workspaces: [{ id: 'ws-1' }, { id: 'ws-2' }],
      lastActiveWorkspaceId: 'ws-1',
    })
    render('ws-1')
    await act(flushMacrotask)
    render('ws-2')
    await act(flushMacrotask)

    expect(visits).toEqual([
      expect.stringContaining('/api/workspaces/ws-1/visit'),
      expect.stringContaining('/api/workspaces/ws-2/visit'),
    ])
    const cached = queryClient.getQueryData<{ workspaces: { id: string }[] }>(
      workspaceKeys.list('active')
    )
    expect(cached?.workspaces.map((workspace) => workspace.id)).toEqual(['ws-2', 'ws-1'])
  })
})

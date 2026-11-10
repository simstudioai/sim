/**
 * @vitest-environment jsdom
 *
 * The tables list's create controls. Failure mode: a read-only member shown New table and New
 * folder as disabled buttons with no reason, a dead control the server would refuse anyway.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import { WorkspaceSession } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { TableList } from '@/app/(product)/workspace/[workspaceId]/tables/_components/table-list/table-list'

const WORKSPACE_ID = 'ws-1'

let viewerPermission: 'read' | 'write' = 'write'
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  viewerPermission = 'write'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      if (url.pathname === `/api/workspaces/${WORKSPACE_ID}/permissions`)
        return Response.json({
          users: [],
          total: 0,
          viewer: { userId: 'viewer', isAdmin: false, permissionType: viewerPermission },
        })
      return Response.json({ error: 'Not found' }, { status: 404 })
    })
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null } },
    isPending: false,
    error: null,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <WorkspaceSession mode='live'>
            <TableList workspaceId={WORKSPACE_ID} />
          </WorkspaceSession>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

function button(name: string) {
  return [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name
  )
}

it('offers New table and New folder to a member who can write', async () => {
  await render()
  expect(button('New table')).toBeDefined()
  expect(button('New folder')).toBeDefined()
})

it('offers no create controls to a read-only member', async () => {
  viewerPermission = 'read'
  await render()
  expect(button('New table')).toBeUndefined()
  expect(button('New folder')).toBeUndefined()
})

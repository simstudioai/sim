/**
 * @vitest-environment jsdom
 *
 * The workflows list's create controls. Failure mode: a read-only member shown Import, New folder
 * and New workflow as disabled buttons with no reason, dead controls the server would refuse anyway.
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

const viewer = vi.hoisted(() => ({ canEdit: true }))

vi.mock('@/app/_styles/fonts/season/season', () => ({
  season: { className: 'test-season-font', variable: 'test-season-variable' },
}))
vi.mock('@/components/workspace-providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({
    canRead: true,
    canEdit: viewer.canEdit,
    canAdmin: false,
    userPermissions: viewer.canEdit ? 'write' : 'read',
    isLoading: false,
    error: null,
  }),
}))

import { WorkspaceSession } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { WorkflowsRoute } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflows-route/workflows-route'

const WORKSPACE_ID = 'ws-1'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  viewer.canEdit = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Not found' }, { status: 404 }))
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
            <WorkflowsRoute workspaceId={WORKSPACE_ID} />
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

it('offers Import, New folder and New workflow to a member who can write', async () => {
  await render()
  expect(button('Import')).toBeDefined()
  expect(button('New folder')).toBeDefined()
  expect(button('New workflow')).toBeDefined()
})

it('offers no create controls to a read-only member', async () => {
  viewer.canEdit = false
  await render()
  expect(button('Import')).toBeUndefined()
  expect(button('New folder')).toBeUndefined()
  expect(button('New workflow')).toBeUndefined()
})

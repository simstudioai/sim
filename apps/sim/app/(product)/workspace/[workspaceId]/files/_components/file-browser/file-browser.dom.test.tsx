/**
 * @vitest-environment jsdom
 *
 * The file browser's create controls. Failure mode: a read-only member shown Upload, New folder and
 * New file as disabled buttons, or as disabled entries in the list's right-click menu, with no
 * reason: dead controls the server would refuse anyway.
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
import { FileBrowser } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-browser/file-browser'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

const WORKSPACE_ID = 'ws-1'

/** Each read the list makes, answered empty so the list settles on its empty state. */
const LISTS: Record<string, unknown> = {
  '/api/workspaces': {
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: 'Workspace',
        ownerId: 'owner',
        organizationId: null,
        workspaceMode: 'personal',
      },
    ],
    lastActiveWorkspaceId: WORKSPACE_ID,
    pinnedWorkspaceIds: [],
    creationPolicy: null,
  },
  '/api/folders': { folders: [] },
  '/api/pinned-items': { pinnedItems: [] },
  [`/api/workspaces/${WORKSPACE_ID}/files`]: { success: true, files: [], nextCursor: null },
  [`/api/workspaces/${WORKSPACE_ID}/files/folders`]: { success: true, folders: [] },
  [`/api/workspaces/${WORKSPACE_ID}/files/folder-stats`]: { success: true, folders: [] },
}

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
      const listed = LISTS[url.pathname]
      if (listed) return Response.json(listed)
      return Response.json({ error: 'Not found' }, { status: 404 })
    })
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null } },
    isPending: false,
    error: null,
  })
  container = document.createElement('div')
  // Menus portal into the nearest EMCN root, as the product shell provides one.
  container.setAttribute('data-emcn', '')
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
          <SurfaceScopeProvider routePrefix='/o/org'>
            <WorkspaceSession mode='live'>
              <FileBrowser workspaceId={WORKSPACE_ID} />
            </WorkspaceSession>
          </SurfaceScopeProvider>
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

/** Right-clicks the list's empty space and reads the entries of the menu it opens, if any. */
async function backgroundMenuEntries() {
  const list = container.querySelector('main')
  if (!list) throw new Error('The page did not render')
  const target = [...list.querySelectorAll('h2, p')].at(-1) ?? list
  act(() => {
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    )
  })
  for (let round = 0; round < 3; round++) await act(flushMacrotask)
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
}

it('offers Upload, New folder and New file to a member who can write', async () => {
  await render()
  expect(button('Upload')).toBeDefined()
  expect(button('New folder')).toBeDefined()
  expect(button('New file')).toBeDefined()
})

it('offers no create controls to a read-only member', async () => {
  viewerPermission = 'read'
  await render()
  expect(button('Upload')).toBeUndefined()
  expect(button('New folder')).toBeUndefined()
  expect(button('New file')).toBeUndefined()
})

it('offers Upload, New folder and New file in the list right-click menu to a member who can write', async () => {
  await render()
  expect(await backgroundMenuEntries()).toEqual(
    expect.arrayContaining(['Upload', 'New folder', 'New file'])
  )
})

it('offers no create entries in the list right-click menu to a read-only member', async () => {
  viewerPermission = 'read'
  await render()
  const entries = await backgroundMenuEntries()
  expect(entries).not.toContain('Upload')
  expect(entries).not.toContain('New folder')
  expect(entries).not.toContain('New file')
})

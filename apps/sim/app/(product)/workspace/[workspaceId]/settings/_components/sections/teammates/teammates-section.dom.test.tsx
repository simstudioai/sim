/**
 * @vitest-environment jsdom
 *
 * Removing a teammate and revoking an invite are destructive, and the invite list is a read of its
 * own. Failure modes: either action firing from the row menu with no confirmation, and a failed
 * invitation read leaving pending invites silently missing from the list.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

const seam = vi.hoisted(() => ({
  removeMember: vi.fn(async () => undefined),
  cancelInvitation: vi.fn(async () => undefined),
  refetchInvitations: vi.fn(),
  invitations: {} as Record<string, unknown>,
}))

vi.mock('@/platform/lib/surface-scope', () => ({
  useSurfaceScope: () => ({ routePrefix: '/o/org' }),
}))
vi.mock('@/platform/lib/data/workspace-settings', () => ({
  useWorkspaceSettingsSection: () => ({ hostContext: null, canMutate: true }),
}))
vi.mock('@/platform/lib/data/teammates', async (importOriginal) => {
  const idle = { mutateAsync: vi.fn(), isPending: false }
  return {
    ...(await importOriginal<object>()),
    useCancelWorkspaceInvitation: () => ({ ...idle, mutateAsync: seam.cancelInvitation }),
    useDeploymentShape: () => ({ billingEnabled: false }),
    usePendingInvitations: () => seam.invitations,
    useRemoveWorkspaceMember: () => ({ ...idle, mutateAsync: seam.removeMember }),
    useResendWorkspaceInvitation: () => idle,
    useSession: () => ({ data: { user: { id: 'viewer' } } }),
    useSettingsSearch: () => ['', () => undefined],
    useUpdateWorkspacePermissions: () => idle,
    useWorkspaceInvitePolicy: () => ({ inviteDisabledReason: null, isInvitationsDisabled: false }),
    useWorkspacePermissionsQuery: () => ({
      isPending: false,
      isError: false,
      data: {
        viewer: { userId: 'viewer' },
        users: [
          {
            userId: 'viewer',
            email: 'viewer@sim.test',
            name: 'Viewer',
            permissionType: 'admin',
            joinedAt: '2026-01-01T00:00:00.000Z',
            isExternal: false,
            roleSource: 'explicit',
          },
          {
            userId: 'ada',
            email: 'ada@sim.test',
            name: 'Ada',
            permissionType: 'write',
            joinedAt: '2026-01-01T00:00:00.000Z',
            isExternal: false,
            roleSource: 'explicit',
          },
        ],
      },
    }),
    useWorkspacesQuery: () => ({ data: [{ id: 'ws', name: 'Workspace', organizationId: null }] }),
    workspaceRoleLockReason: () => null,
  }
})

import TeammatesSection from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/teammates/teammates-section'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  seam.removeMember.mockClear()
  seam.cancelInvitation.mockClear()
  seam.invitations = {
    isError: false,
    data: [
      {
        invitationId: 'inv-1',
        email: 'grace@sim.test',
        permissionType: 'read',
        isExternal: false,
        token: 't',
      },
    ],
  }
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function view() {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}
    >
      <TeammatesSection workspaceId='ws' subpath={[]} />
    </QueryClientProvider>
  )
}

async function choose(row: string, item: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Actions for ${row}"]`
  )
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      trigger?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  })
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === item
  )
  await act(async () => entry?.click())
}

async function confirm(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (candidate) => candidate.textContent === label
  )
  await act(async () => button?.click())
}

it('removes a teammate only once the viewer confirms', async () => {
  act(() => root.render(view()))
  await choose('Ada', 'Remove')
  expect(seam.removeMember).not.toHaveBeenCalled()
  await confirm('Remove')
  expect(seam.removeMember).toHaveBeenCalledWith({ userId: 'ada', workspaceId: 'ws' })
})

it('revokes an invite only once the viewer confirms', async () => {
  act(() => root.render(view()))
  await choose('grace@sim.test', 'Revoke invite')
  expect(seam.cancelInvitation).not.toHaveBeenCalled()
  await confirm('Revoke')
  expect(seam.cancelInvitation).toHaveBeenCalledWith({ invitationId: 'inv-1', workspaceId: 'ws' })
})

it('shows a failed invitation read with Retry instead of omitting the invites', async () => {
  seam.invitations = {
    isError: true,
    error: new Error('boom'),
    isFetching: false,
    data: undefined,
    refetch: seam.refetchInvitations,
  }
  act(() => root.render(view()))
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry'
  )
  expect(retry).toBeDefined()
  await act(async () => retry?.click())
  expect(seam.refetchInvitations).toHaveBeenCalled()
})

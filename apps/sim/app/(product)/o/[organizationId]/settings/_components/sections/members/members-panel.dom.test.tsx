/**
 * @vitest-environment jsdom
 *
 * Removing someone from a workspace and revoking an invite are destructive. Failure mode: either
 * firing straight from the row menu with no confirmation, so a stray click costs a person their
 * access or voids an invite.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

const seam = vi.hoisted(() => ({
  removeFromWorkspace: vi.fn(async () => undefined),
  revokeInvitation: vi.fn(async () => undefined),
}))

vi.mock('@/app/(product)/_components/invite-modal/invite-modal', () => ({
  InviteModal: () => null,
}))
vi.mock(
  '@/app/(product)/o/[organizationId]/settings/_components/sections/members/remove-member-modal',
  () => ({ RemoveMemberModal: () => null })
)
vi.mock(
  '@/app/(product)/o/[organizationId]/settings/_components/sections/members/transfer-ownership-modal',
  () => ({ TransferOwnershipModal: () => null })
)
vi.mock('@/platform/lib/data/members', async () => {
  const { toRosterModel } = await import('@/platform/shared/members')
  const access = (workspaceId: string) => ({
    workspaceId,
    workspaceName: 'Acme',
    permission: 'write' as const,
    roleSource: 'explicit' as const,
    isBilledAccount: false,
  })
  const model = toRosterModel(
    {
      members: [
        {
          memberId: 'm-viewer',
          userId: 'viewer',
          role: 'owner',
          createdAt: '2026-01-01T00:00:00.000Z',
          name: 'Viewer',
          email: 'viewer@sim.test',
          image: null,
          suspendedAt: null,
          workspaces: [],
        },
        {
          memberId: 'm-ada',
          userId: 'ada',
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
          name: 'Ada',
          email: 'ada@sim.test',
          image: null,
          suspendedAt: null,
          workspaces: [access('ws')],
        },
      ],
      pendingInvitations: [
        {
          id: 'inv-1',
          email: 'grace@sim.test',
          role: 'member',
          kind: 'organization',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-12-01T00:00:00.000Z',
          inviteeName: null,
          inviteeImage: null,
          workspaces: [],
        },
      ],
      workspaces: [{ id: 'ws', name: 'Acme' }],
    },
    { userId: 'viewer', canManage: true, hosted: false, timeZone: 'UTC' }
  )
  return {
    useMemberSearch: () => ({ search: '', setSearch: () => undefined }),
    useMembers: () => ({
      viewerId: 'viewer',
      canManage: true,
      canLeave: false,
      canInvite: true,
      roster: { status: 'success', model, error: null, retrying: false, retry: () => undefined },
      seats: { visible: false },
      actions: {
        rolePending: false,
        invitationPending: false,
        permissionPending: false,
        changeRole: vi.fn(),
        changeInvitationRole: vi.fn(),
        changePermission: vi.fn(),
        changeInvitationPermission: vi.fn(),
        resendInvitation: vi.fn(),
        removeFromWorkspace: seam.removeFromWorkspace,
        revokeInvitation: seam.revokeInvitation,
      },
    }),
  }
})

import { MembersPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/members-panel'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  seam.removeFromWorkspace.mockClear()
  seam.revokeInvitation.mockClear()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(<MembersPanel organization={{} as PlatformOrganization} />))
}

/** Opens the `index`th menu with this label and picks an item. */
async function choose(label: string, item: string, index = 0) {
  const trigger = container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[
    index
  ]
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      trigger?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  })
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === item
  )
  expect(entry).toBeDefined()
  await act(async () => entry?.click())
}

async function confirm(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (candidate) => candidate.textContent === label
  )
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

it('removes a member from a workspace only once the viewer confirms', async () => {
  render()
  // Ada's first row is the organization roster's; the second is her row in the Acme workspace.
  await choose('Actions for Ada', 'Remove from workspace', 1)
  expect(seam.removeFromWorkspace).not.toHaveBeenCalled()
  await confirm('Remove')
  expect(seam.removeFromWorkspace).toHaveBeenCalledWith('ada', 'ws')
})

it('revokes an invite only once the viewer confirms', async () => {
  render()
  await choose('Actions for grace@sim.test', 'Revoke invite')
  expect(seam.revokeInvitation).not.toHaveBeenCalled()
  await confirm('Revoke')
  expect(seam.revokeInvitation).toHaveBeenCalledWith('inv-1')
})

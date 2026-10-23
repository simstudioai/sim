/** @vitest-environment jsdom */

import { act } from 'react'
import { ToastProvider } from '@sim/emcn'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyInvitation } from '@/lib/api/contracts/invitations'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  decline: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
}))

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)
vi.mock('@/hooks/queries/invitations', () => ({
  useMyPendingInvitations: mocks.query,
  useAcceptMyInvitation: () => ({ isPending: false, mutateAsync: mocks.accept }),
  useDeclineMyInvitation: () => ({ isPending: false, mutateAsync: mocks.decline }),
}))

import { ViewInvitationsModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-modal'

const mockPush = nextNavigationMockFns.router.push
nextNavigationMockFns.mockUsePathname.mockReturnValue('/workspace/workspace-1/home')

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

let container: HTMLDivElement
let root: Root
let invitation: MyInvitation

function button(label: string) {
  return Array.from(document.body.querySelectorAll('button')).find(
    (item) => item.textContent === label
  )
}

async function renderModal() {
  await act(async () =>
    root.render(
      <ToastProvider>
        <ViewInvitationsModal open onOpenChange={mocks.close} />
      </ToastProvider>
    )
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  invitation = {
    id: 'invitation-1',
    kind: 'organization',
    email: 'invitee@example.com',
    organizationId: 'org-1',
    organizationName: 'Target Team',
    membershipIntent: 'internal',
    role: 'admin',
    status: 'pending',
    expiresAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    inviterName: 'Inviter',
    inviterEmail: 'inviter@example.com',
    grants: [],
    joinPreview: {
      outcome: 'will-join',
      organizationName: 'Target Team',
      workspacesToMove: ['Personal work', 'Archived project'],
      workspaceIdsToMove: ['personal', 'archived'],
    },
  }
  mocks.query.mockImplementation(() => ({
    data: [invitation],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  }))
  mocks.accept.mockResolvedValue({ redirectPath: '/o/org-1/home' })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ViewInvitationsModal', () => {
  it('keeps multiple workspace invitations and their grants attached to the correct actions', async () => {
    const first: MyInvitation = {
      ...invitation,
      kind: 'workspace',
      membershipIntent: 'external',
      grants: [
        {
          workspaceId: 'alpha',
          workspaceName: 'Alpha',
          workspaceLogoUrl: 'https://example.com/alpha.png',
          permission: 'admin',
        },
      ],
      joinPreview: {
        outcome: 'external',
        organizationName: null,
        workspaceIdsToMove: [],
        workspacesToMove: [],
      },
    }
    const second: MyInvitation = {
      ...first,
      id: 'invitation-2',
      grants: [
        {
          workspaceId: 'design',
          workspaceName: 'Design',
          workspaceLogoUrl: 'https://example.com/design.png',
          permission: 'read',
        },
        { workspaceId: 'engineering', workspaceName: 'Engineering', permission: 'write' },
      ],
    }
    mocks.query.mockReturnValue({ data: [first, second], isPending: false, isError: false })
    await renderModal()
    expect(document.body.textContent).not.toContain('Before you join')
    expect(document.body.textContent).not.toContain('without joining an organization')
    const firstRow = document.querySelector('section[aria-label="Invitation to Alpha"]')
    expect(firstRow?.textContent).toContain('admin access')
    expect(firstRow?.querySelector('ul')).toBeNull()
    expect(firstRow?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/alpha.png'
    )
    const secondRow = Array.from(document.querySelectorAll('section')).find(
      (row) => row.getAttribute('aria-label') === 'Invitation to Design +1'
    )
    expect(secondRow).toBeDefined()
    const grants = Array.from(secondRow?.querySelectorAll('li') ?? [], (row) => row.textContent)
    expect(grants).toHaveLength(2)
    expect(grants[0]).toContain('Designread access')
    expect(grants[1]).toContain('Engineeringwrite access')
    expect(secondRow?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/design.png'
    )
    const accept = Array.from(secondRow?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Accept'
    )
    expect(accept).toBeDefined()
    await act(async () => accept?.click())
    expect(mocks.accept).toHaveBeenCalledWith({
      invitationId: 'invitation-2',
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'external',
    })
  })

  it('discloses the complete migration and sends exactly those workspace IDs on acceptance', async () => {
    await renderModal()
    expect(document.body.textContent).toContain(
      'You will join Target Team as an organization admin'
    )
    expect(document.body.textContent).toContain('including archived workspaces')
    expect(
      Array.from(
        document.querySelectorAll('[aria-label="Workspaces moving into the organization"] li'),
        (item) => item.textContent
      )
    ).toEqual(['Personal work', 'Archived project'])
    const disclosure = document.querySelector(
      '[aria-label="Workspaces moving into the organization"]'
    )
    expect(disclosure?.compareDocumentPosition(button('Accept')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(mocks.accept).not.toHaveBeenCalled()
    await act(async () => button('Accept')?.click())
    expect(mocks.accept).toHaveBeenCalledWith({
      invitationId: 'invitation-1',
      disclosedWorkspaceIds: ['personal', 'archived'],
      disclosedOutcome: 'will-join',
    })
    expect(mockPush).toHaveBeenCalledWith('/o/org-1/home')
  })

  it('blocks an internal invitation with no preview and offers refresh', async () => {
    invitation.joinPreview = null
    await renderModal()
    expect(document.body.textContent).toContain('We could not load how this invitation affects')
    expect(button('Accept')?.disabled).toBe(true)
    await act(async () => button('Accept')?.click())
    expect(mocks.accept).not.toHaveBeenCalled()
    await act(async () => button('Refresh invitation')?.click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
})

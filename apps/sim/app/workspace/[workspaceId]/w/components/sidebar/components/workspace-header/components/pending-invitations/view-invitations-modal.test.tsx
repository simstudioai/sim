/** @vitest-environment jsdom */
import { act } from 'react'
import { ToastProvider } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyInvitation } from '@/lib/api/contracts/invitations'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  decline: vi.fn(),
  push: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/workspace/workspace-1/home',
}))
vi.mock('@/hooks/queries/invitations', () => ({
  useMyPendingInvitations: mocks.query,
  useAcceptMyInvitation: () => ({ isPending: false, mutateAsync: mocks.accept }),
  useDeclineMyInvitation: () => ({ isPending: false, mutateAsync: mocks.decline }),
}))

import { ViewInvitationsModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-modal'

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
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ViewInvitationsModal', () => {
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
    expect(mocks.push).toHaveBeenCalledWith('/o/org-1/home')
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

  it.each([
    ['external', 'workspace access without joining an organization'],
    ['already-member', 'Your organization role will stay the same'],
    ['blocked', 'This invitation cannot currently be accepted'],
  ] as const)('discloses %s and preserves its empty-set stale check', async (outcome, message) => {
    invitation.joinPreview = {
      outcome,
      organizationName: null,
      workspacesToMove: [],
      workspaceIdsToMove: [],
    }
    await renderModal()
    expect(document.body.textContent).toContain(message)
    expect(document.body.textContent).not.toContain('as an organization admin')
    await act(async () => button('Accept')?.click())
    expect(mocks.accept).toHaveBeenCalledWith({
      invitationId: 'invitation-1',
      disclosedWorkspaceIds: [],
      disclosedOutcome: outcome,
    })
  })

  it('describes an empty workspace migration without omitting its stale check', async () => {
    invitation.joinPreview = {
      outcome: 'will-join',
      organizationName: 'Target Team',
      workspacesToMove: [],
      workspaceIdsToMove: [],
    }
    await renderModal()
    expect(document.body.textContent).toContain('You have no personal workspaces to move')
    await act(async () => button('Accept')?.click())
    expect(mocks.accept).toHaveBeenCalledWith({
      invitationId: 'invitation-1',
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'will-join',
    })
  })

  it('shows loading rather than an empty list while invitations are pending', async () => {
    mocks.query.mockReturnValue({ data: undefined, isPending: true, isError: false })
    await renderModal()
    expect(document.body.textContent).toContain('Loading invitations')
    expect(document.body.textContent).not.toContain('No pending invitations')
    expect(button('Accept')).toBeUndefined()
  })

  it('retries fetch errors without claiming there are no invitations', async () => {
    mocks.query.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('Invitations could not be loaded'),
      isFetching: false,
      refetch: mocks.refetch,
    })
    await renderModal()
    expect(document.body.textContent).toContain('Invitations could not be loaded')
    expect(document.body.textContent).not.toContain('No pending invitations')
    expect(button('Accept')).toBeUndefined()
    await act(async () => button('Try again')?.click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('shows an empty list only after a successful query', async () => {
    mocks.query.mockReturnValue({ data: [], isPending: false, isError: false })
    await renderModal()
    expect(document.body.textContent).toContain('No pending invitations')
    expect(button('Accept')).toBeUndefined()
  })
})

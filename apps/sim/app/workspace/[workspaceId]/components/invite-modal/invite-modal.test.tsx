/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { hostContext, mockUseOrganizationBilling, mockUseAdminWorkspaces, mockMutate } = vi.hoisted(
  () => ({
    hostContext: {
      current: {
        hostOrganizationId: 'org-host',
        viewer: { isHostOrganizationAdmin: false },
      },
    },
    mockUseOrganizationBilling: vi.fn(),
    mockUseAdminWorkspaces: vi.fn(),
    mockMutate: vi.fn(),
  })
)

vi.mock('@sim/emcn', () => ({
  ChipDropdown: () => <div />,
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalField: () => <div />,
  ChipModalFooter: () => <div />,
  ChipModalHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  toast: { success: vi.fn() },
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', email: 'viewer@example.com' } } }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => hostContext.current,
}))

vi.mock('@/hooks/queries/invitations', () => ({
  useSendWorkspaceInvitations: () => ({ isPending: false, mutate: mockMutate }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: (...args: unknown[]) => {
    mockUseOrganizationBilling(...args)
    return { data: undefined }
  },
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useAdminWorkspaces: (...args: unknown[]) => {
    mockUseAdminWorkspaces(...args)
    return { data: [] }
  },
}))

import {
  buildInviteFailureMessage,
  InviteModal,
} from '@/app/workspace/[workspaceId]/components/invite-modal/invite-modal'

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('InviteModal organization billing isolation', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    hostContext.current = {
      hostOrganizationId: 'org-host',
      viewer: { isHostOrganizationAdmin: false },
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('does not fetch admin billing data for a workspace-only administrator', async () => {
    await act(async () => {
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          workspaceId='workspace-1'
          organizationId='org-host'
          workspaceName='Host'
        />
      )
    })

    expect(mockUseOrganizationBilling).toHaveBeenCalledWith('org-host', { enabled: false })
  })

  it('fetches seat data for an administrator of the routed host organization', async () => {
    hostContext.current = {
      hostOrganizationId: 'org-host',
      viewer: { isHostOrganizationAdmin: true },
    }

    await act(async () => {
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          workspaceId='workspace-1'
          organizationId='org-host'
          workspaceName='Host'
        />
      )
    })

    expect(mockUseOrganizationBilling).toHaveBeenCalledWith('org-host', { enabled: true })
  })

  it('does not fetch billing data for a stale organization prop', async () => {
    hostContext.current = {
      hostOrganizationId: 'org-host',
      viewer: { isHostOrganizationAdmin: true },
    }

    await act(async () => {
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          workspaceId='workspace-1'
          organizationId='org-other'
          workspaceName='Host'
        />
      )
    })

    expect(mockUseOrganizationBilling).toHaveBeenCalledWith('org-other', { enabled: false })
  })

  it('does not list selectable workspaces outside an organization', async () => {
    await act(async () => {
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          workspaceId='workspace-1'
          organizationId={null}
          workspaceName='Personal'
        />
      )
    })

    expect(mockUseAdminWorkspaces).toHaveBeenCalledWith('user-1', undefined, { enabled: false })
  })
})

describe('buildInviteFailureMessage', () => {
  const notPaid = (email: string) =>
    `${email} is not on a paid Sim plan, so they cannot be added as an external collaborator. Invite them as a Member or Admin instead — that adds a seat.`

  it('returns the reason alone for a single failure, which already names the address', () => {
    expect(buildInviteFailureMessage([{ email: 'a@x.com', error: notPaid('a@x.com') }], 3)).toBe(
      notPaid('a@x.com')
    )
  })

  it('names every address when a whole batch is rejected for the same cause', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: notPaid('a@x.com') },
        { email: 'b@x.com', error: notPaid('b@x.com') },
        { email: 'c@x.com', error: notPaid('c@x.com') },
      ],
      3
    )

    expect(message).toContain('None of the 3 invitations could be sent.')
    expect(message).toContain('a@x.com')
    expect(message).toContain('b@x.com')
    expect(message).toContain('c@x.com')
  })

  it('reports the denominator when only some of the batch failed', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: notPaid('a@x.com') },
        { email: 'b@x.com', error: 'b@x.com has already been invited to this workspace' },
      ],
      5
    )

    expect(message).toContain('2 of 5 invitations could not be sent.')
    expect(message).toContain('b@x.com has already been invited to this workspace')
  })

  it('collapses identical reasons instead of repeating them', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: 'Something went wrong' },
        { email: 'b@x.com', error: 'Something went wrong' },
      ],
      2
    )

    expect(message).toBe('None of the 2 invitations could be sent. Something went wrong')
  })

  it('counts the reasons it cannot list rather than dropping them silently', () => {
    const message = buildInviteFailureMessage(
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({
        email: `${name}@x.com`,
        error: notPaid(`${name}@x.com`),
      })),
      5
    )

    expect(message).toContain('None of the 5 invitations could be sent.')
    expect(message).toContain('c@x.com')
    expect(message).not.toContain('d@x.com')
    expect(message).toContain('And 2 more.')
  })
})

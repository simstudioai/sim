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

import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal/invite-modal'

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

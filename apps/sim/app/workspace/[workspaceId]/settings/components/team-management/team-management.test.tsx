/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsAdminOrOwner,
  mockUseOrganization,
  mockUseOrganizationBilling,
  mockUseOrganizationRoster,
} = vi.hoisted(() => ({
  mockIsAdminOrOwner: vi.fn(),
  mockUseOrganization: vi.fn(),
  mockUseOrganizationBilling: vi.fn(),
  mockUseOrganizationRoster: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-1', email: 'viewer' } } }),
}))

vi.mock('@/lib/billing/client/utils', () => ({
  getSubscriptionAccessState: () => ({
    hasUsableTeamAccess: false,
    hasUsableEnterpriseAccess: false,
  }),
}))

vi.mock('@/lib/workspaces/organization', () => ({
  generateSlug: (value: string) => value.toLowerCase(),
  isAdminOrOwner: mockIsAdminOrOwner,
}))

vi.mock('@/app/workspace/[workspaceId]/components/invite-modal', () => ({
  InviteModal: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingsQueryErrorState: ({
    error,
    fallback,
    isRetrying,
    onRetry,
  }: {
    error: unknown
    fallback: string
    isRetrying: boolean
    onRetry: () => void
  }) => (
    <div>
      {getErrorMessage(error, fallback)}
      <button type='button' disabled={isRetrying} onClick={onRetry}>
        {isRetrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    actions = [],
  }: {
    children?: ReactNode
    actions?: { text: string; disabled?: boolean; onSelect: () => void }[]
  }) => (
    <section>
      {actions.map((action) => (
        <button
          type='button'
          key={action.text}
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.text}
        </button>
      ))}
      {children}
    </section>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/team-management/components', () => ({
  NoOrganizationView: () => <div>no-organization-view</div>,
  OrganizationMemberLists: () => <div>organization-member-lists</div>,
  RemoveMemberDialog: () => null,
  TeamSeatsOverview: () => <div>team-seats-overview</div>,
  TransferOwnershipDialog: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/use-settings-search', () => ({
  useSettingsSearch: () => ['', vi.fn()],
}))

vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ isInvitationsDisabled: false }),
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useOpenBillingPortal: () => ({ mutate: vi.fn() }),
  useSubscriptionData: () => ({ data: undefined, isPending: false }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  useCreateOrganization: () => ({ error: null, isPending: false, mutateAsync: vi.fn() }),
  useMemberRemovalImpact: () => ({ data: [], isError: false, isFetching: false }),
  useOrganization: mockUseOrganization,
  useOrganizationBilling: mockUseOrganizationBilling,
  useOrganizationRoster: mockUseOrganizationRoster,
  useRemoveMember: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTransferOwnership: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { TeamManagement } from '@/app/workspace/[workspaceId]/settings/components/team-management/team-management'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockIsAdminOrOwner.mockReturnValue(false)
  mockUseOrganizationBilling.mockReturnValue({
    data: undefined,
    error: null,
    isLoading: false,
  })
  mockUseOrganizationRoster.mockReturnValue({
    data: { members: [], pendingInvitations: [], workspaces: [] },
    error: null,
    isLoading: false,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('TeamManagement organization errors', () => {
  it.each([
    { admin: true, canInvite: false, shown: true, disabled: true },
    { admin: true, canInvite: true, shown: true, disabled: false },
    { admin: false, canInvite: false, shown: false, disabled: false },
  ])(
    'respects the org invitation capability for admin=$admin, allowed=$canInvite',
    ({ admin, canInvite, shown, disabled }) => {
      mockIsAdminOrOwner.mockReturnValue(admin)
      mockUseOrganization.mockReturnValue({ data: { id: 'org-1' }, error: null, isLoading: false })
      act(() =>
        root.render(
          <TeamManagement
            organizationId='org-1'
            billingHref='/o/org-1/settings/billing'
            canInviteMembers={canInvite}
          />
        )
      )
      const invite = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Invite'
      )
      expect(Boolean(invite)).toBe(shown)
      if (invite) expect(invite.disabled).toBe(disabled)
    }
  )
  it('shows the organization error instead of the missing-organization recovery view', () => {
    mockUseOrganization.mockReturnValue({
      data: undefined,
      error: new Error('Organization request failed'),
      isLoading: false,
    })

    act(() =>
      root.render(
        <TeamManagement organizationId='org-1' billingHref='/workspace/ws-1/settings/billing' />
      )
    )

    expect(container.textContent).toContain('Organization request failed')
    expect(container.textContent).not.toContain('no-organization-view')
  })

  it('does not render a false member count while the roster is pending', () => {
    mockUseOrganization.mockReturnValue({
      data: { id: 'org-1' },
      error: null,
      isLoading: false,
    })
    mockUseOrganizationRoster.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    })

    act(() =>
      root.render(
        <TeamManagement organizationId='org-1' billingHref='/workspace/ws-1/settings/billing' />
      )
    )

    expect(container.textContent).toContain('Loading members…')
    expect(container.textContent).not.toContain('organization-member-lists')
  })

  it('shows a roster failure instead of an empty member list', () => {
    mockUseOrganization.mockReturnValue({
      data: { id: 'org-1' },
      error: null,
      isLoading: false,
    })
    mockUseOrganizationRoster.mockReturnValue({
      data: undefined,
      error: new Error('Roster request failed'),
      isLoading: false,
    })

    act(() =>
      root.render(
        <TeamManagement organizationId='org-1' billingHref='/workspace/ws-1/settings/billing' />
      )
    )

    expect(container.textContent).toContain('Roster request failed')
    expect(container.textContent).not.toContain('organization-member-lists')
  })

  it('shows a retryable billing failure instead of a subscription upsell', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    mockIsAdminOrOwner.mockReturnValue(true)
    mockUseOrganization.mockReturnValue({
      data: { id: 'org-1' },
      error: null,
      isLoading: false,
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: undefined,
      error: new Error('Billing request failed'),
      isLoading: false,
      refetch,
    })

    act(() =>
      root.render(
        <TeamManagement organizationId='org-1' billingHref='/workspace/ws-1/settings/billing' />
      )
    )

    expect(container.textContent).toContain('Billing request failed')
    expect(container.textContent).toContain('Try again')
    expect(container.textContent).not.toContain('team-seats-overview')

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Try again')
        ?.click()
    })
    expect(refetch).toHaveBeenCalledOnce()
  })
})

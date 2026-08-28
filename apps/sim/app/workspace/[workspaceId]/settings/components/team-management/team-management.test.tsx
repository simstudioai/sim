/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseOrganization } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { email: 'viewer' } } }),
}))

vi.mock('@/lib/billing/client/utils', () => ({
  getSubscriptionAccessState: () => ({
    hasUsableTeamAccess: false,
    hasUsableEnterpriseAccess: false,
  }),
}))

vi.mock('@/lib/workspaces/organization', () => ({
  generateSlug: (value: string) => value.toLowerCase(),
  isAdminOrOwner: () => false,
}))

vi.mock('@/app/workspace/[workspaceId]/components/invite-modal', () => ({
  InviteModal: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/team-management/components', () => ({
  NoOrganizationView: () => <div>no-organization-view</div>,
  OrganizationMemberLists: () => null,
  RemoveMemberDialog: () => null,
  TeamSeatsOverview: () => null,
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
  useOrganizationBilling: () => ({ data: undefined, isLoading: false }),
  useOrganizationRoster: () => ({ data: undefined, isLoading: false }),
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
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('TeamManagement organization errors', () => {
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
})

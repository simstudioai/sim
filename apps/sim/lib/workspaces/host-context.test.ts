import {
  billingWorkspaceAccessMock,
  billingWorkspaceAccessMockFns,
} from '@sim/testing/mocks/billing-workspace-access.mock'
import { credentialGroupsAvailabilityMock } from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOrganizationSettingsAccess } = vi.hoisted(() => ({
  mockGetOrganizationSettingsAccess: vi.fn(),
}))

vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/organizations/settings-access', () => ({
  getOrganizationSettingsAccess: mockGetOrganizationSettingsAccess,
}))

vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

const { mockCheckWorkspaceAccess } = permissionsMockFns
const { mockGetWorkspaceOwnerSubscriptionAccess } = billingWorkspaceAccessMockFns
const { mockResolveKnowledgeAccessAvailability, mockIsKnowledgeMemberAccessAvailable } =
  knowledgeAvailabilityMockFns

const OWNER_BILLING = {
  plan: 'enterprise',
  status: 'active',
  isPaid: true,
  isPro: false,
  isTeam: false,
  isEnterprise: true,
  isOrgScoped: true,
  organizationId: 'org-host',
  billingInterval: 'month',
  billingBlocked: false,
  billingBlockedReason: null,
}

function accessibleWorkspace(
  permission: 'admin' | 'write' | 'read',
  organizationId: string | null
) {
  return {
    exists: true,
    hasAccess: true,
    canWrite: permission !== 'read',
    canAdmin: permission === 'admin',
    permission,
    workspace: {
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'owner-1',
      organizationId,
      workspaceMode: organizationId ? 'organization' : 'personal',
      billedAccountUserId: 'owner-1',
      allowPersonalApiKeys: false,
    },
  }
}

describe('getWorkspaceHostContextForViewer', () => {
  beforeEach(() => {
    mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue(OWNER_BILLING)
    mockResolveKnowledgeAccessAvailability.mockResolvedValue({
      memberScoped: true,
      sourceMirrored: true,
    })
    mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(true)
  })

  it.each([
    { organizationSearch: true, workspaceKnowledge: false },
    { organizationSearch: false, workspaceKnowledge: true },
  ])(
    'uses organization rollout $organizationSearch independently of workspace knowledge $workspaceKnowledge',
    async ({ organizationSearch, workspaceKnowledge }) => {
      mockCheckWorkspaceAccess.mockResolvedValue(accessibleWorkspace('admin', 'org-host'))
      mockGetOrganizationSettingsAccess.mockResolvedValue({
        role: 'admin',
        isMember: true,
        isAdmin: true,
      })
      mockResolveKnowledgeAccessAvailability.mockResolvedValue({
        memberScoped: workspaceKnowledge,
        sourceMirrored: workspaceKnowledge,
      })
      mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(organizationSearch)

      const context = await getWorkspaceHostContextForViewer('workspace-1', 'admin-1')

      expect(context?.features).toEqual({
        credentialGroups: true,
        organizationSearch,
        knowledgeMemberAccess: workspaceKnowledge,
        knowledgeSourceMirroredAccess: workspaceKnowledge,
      })
      expect(mockIsKnowledgeMemberAccessAvailable).toHaveBeenCalledExactlyOnceWith({
        organizationId: 'org-host',
      })
      expect(mockResolveKnowledgeAccessAvailability).toHaveBeenCalledExactlyOnceWith({
        workspaceId: 'workspace-1',
        ownerBilling: OWNER_BILLING,
      })
    }
  )

  it('keeps an external collaborator authorized only by their workspace grant', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue(accessibleWorkspace('read', 'org-host'))
    mockGetOrganizationSettingsAccess.mockResolvedValue({
      role: null,
      isMember: false,
      isAdmin: false,
    })

    const context = await getWorkspaceHostContextForViewer('workspace-1', 'external-1')

    expect(context?.viewer).toEqual({
      permission: 'read',
      isHostOrganizationMember: false,
      isHostOrganizationAdmin: false,
      organizationRole: null,
    })
    expect(context?.hostOrganizationId).toBe('org-host')
    expect(context?.features?.organizationSearch).toBe(false)
    expect(mockIsKnowledgeMemberAccessAvailable).not.toHaveBeenCalled()
  })

  it('returns null before loading entitlements when the viewer has no access', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      canAdmin: false,
      permission: null,
      workspace: accessibleWorkspace('read', 'org-host').workspace,
    })

    const context = await getWorkspaceHostContextForViewer('workspace-1', 'viewer-1')

    expect(context).toBeNull()
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mockIsKnowledgeMemberAccessAvailable).not.toHaveBeenCalled()
    expect(mockResolveKnowledgeAccessAvailability).not.toHaveBeenCalled()
  })
})

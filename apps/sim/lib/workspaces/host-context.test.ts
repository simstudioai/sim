/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckWorkspaceAccess,
  mockGetWorkspaceOwnerSubscriptionAccess,
  mockGetOrganizationSettingsAccess,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetWorkspaceOwnerSubscriptionAccess: vi.fn(),
  mockGetOrganizationSettingsAccess: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/organizations/settings-access', () => ({
  getOrganizationSettingsAccess: mockGetOrganizationSettingsAccess,
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mockGetWorkspaceOwnerSubscriptionAccess,
}))

import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

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
    },
  }
}

describe('getWorkspaceHostContextForViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue(OWNER_BILLING)
  })

  it('returns host membership and route permission for an internal member', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue(accessibleWorkspace('write', 'org-host'))
    mockGetOrganizationSettingsAccess.mockResolvedValue({
      role: 'member',
      isMember: true,
      isAdmin: false,
    })

    const context = await getWorkspaceHostContextForViewer('workspace-1', 'viewer-1')

    expect(context).toEqual(
      expect.objectContaining({
        hostOrganizationId: 'org-host',
        viewer: {
          permission: 'write',
          isHostOrganizationMember: true,
          isHostOrganizationAdmin: false,
        },
      })
    )
  })

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
    })
    expect(context?.hostOrganizationId).toBe('org-host')
  })

  it('returns null organization context for a personal workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue(accessibleWorkspace('admin', null))
    mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue({
      ...OWNER_BILLING,
      isOrgScoped: false,
      organizationId: null,
    })

    const context = await getWorkspaceHostContextForViewer('workspace-1', 'owner-1')

    expect(context).toEqual(
      expect.objectContaining({
        hostOrganizationId: null,
        viewer: {
          permission: 'admin',
          isHostOrganizationMember: false,
          isHostOrganizationAdmin: false,
        },
      })
    )
    expect(mockGetOrganizationSettingsAccess).not.toHaveBeenCalled()
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
  })
})

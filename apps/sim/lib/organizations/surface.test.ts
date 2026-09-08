/**
 * @vitest-environment node
 */
import { member, organization } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSearchAccess, mockPermissionConfig, mockEnterprisePlan } = vi.hoisted(() => ({
  mockSearchAccess: vi.fn(),
  mockPermissionConfig: vi.fn(),
  mockEnterprisePlan: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mockPermissionConfig,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockEnterprisePlan,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mockSearchAccess,
}))

import {
  getOrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

afterAll(resetDbChainMock)
afterAll(resetEnvFlagsMock)

describe('getOrganizationSurfaceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockSearchAccess.mockResolvedValue({ memberScoped: true, sourceMirrored: false })
    mockPermissionConfig.mockResolvedValue(null)
    mockEnterprisePlan.mockResolvedValue(true)
    setEnvFlags({ isInvitationsDisabled: false, isHosted: true, isBillingEnabled: true })
  })

  it('returns the organization and the viewer standing for a member', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [
      { id: 'org-1', name: 'Acme', slug: 'acme', logo: 'https://cdn/logo.png' },
    ])
    queueTableRows(member, [{ memberCount: 3 }])

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        logo: 'https://cdn/logo.png',
        memberCount: 3,
      },
      viewer: {
        role: 'admin',
        isAdmin: true,
        canInviteMembers: true,
        canUsePersonalApiKeys: true,
      },
      connectedAccountsAvailable: true,
      searchAccess: { memberScoped: true, sourceMirrored: false },
      settingsFeatures: expect.objectContaining({
        hosted: true,
        billingEnabled: true,
        hasEnterprisePlan: true,
      }),
    })
    expect(mockSearchAccess).toHaveBeenCalledWith({ organizationId: 'org-1' })
    expect(mockEnterprisePlan).toHaveBeenCalledWith('org-1')
  })

  it('normalizes a missing logo to null', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: undefined }])
    queueTableRows(member, [{ memberCount: 1 }])

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
      organization: { logo: null },
      viewer: { role: 'member', isAdmin: false },
      settingsFeatures: expect.objectContaining({ hasEnterprisePlan: false }),
    })
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('resolves self-hosted settings from deployment flags without a plan read', async () => {
    setEnvFlags({ isHosted: false, isBillingEnabled: false, isAuditLogsEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
    queueTableRows(member, [{ memberCount: 1 }])

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
      settingsFeatures: {
        hosted: false,
        billingEnabled: false,
        selfHosted: { 'audit-logs': true },
      },
    })
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it.each([
    { role: 'owner', policyDisabled: false, deploymentDisabled: false, allowed: true },
    { role: 'admin', policyDisabled: true, deploymentDisabled: false, allowed: false },
    { role: 'admin', policyDisabled: false, deploymentDisabled: true, allowed: false },
    { role: 'member', policyDisabled: false, deploymentDisabled: false, allowed: false },
  ])(
    'projects invitation policy for $role: $allowed',
    async ({ role, policyDisabled, deploymentDisabled, allowed }) => {
      queueTableRows(member, [{ role }])
      queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
      queueTableRows(member, [{ memberCount: 1 }])
      setEnvFlags({ isInvitationsDisabled: deploymentDisabled })
      mockPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableInvitations: policyDisabled,
      })

      await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
        viewer: { canInviteMembers: allowed },
      })
      expect(mockPermissionConfig).toHaveBeenCalledWith('org-1')
    }
  )

  it('denies a viewer who is not a member without reading the organization', async () => {
    queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toBeNull()
    expect(mockSearchAccess).not.toHaveBeenCalled()
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('denies a membership whose organization row is gone', async () => {
    queueTableRows(member, [{ role: 'member' }])

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toBeNull()
  })
})

describe('resolveOrganizationLanding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('prefers the active organization when the viewer belongs to it', async () => {
    queueTableRows(member, [{ organizationId: 'org-1' }, { organizationId: 'org-2' }])

    await expect(resolveOrganizationLanding('viewer', 'org-2')).resolves.toBe('org-2')
  })

  it('falls back to the earliest membership when the active organization is foreign', async () => {
    queueTableRows(member, [{ organizationId: 'org-1' }, { organizationId: 'org-2' }])

    await expect(resolveOrganizationLanding('viewer', 'org-other')).resolves.toBe('org-1')
  })

  it('returns null for a viewer with no memberships', async () => {
    await expect(resolveOrganizationLanding('viewer', null)).resolves.toBeNull()
  })
})

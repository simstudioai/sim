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
  /** The nav lists Access Control on the regime; these tests drive it from the plan knob. */
  isOrganizationPermissionRegimeActive: mockEnterprisePlan,
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
    resetDbChainMock()
    mockSearchAccess.mockResolvedValue({ memberScoped: true, sourceMirrored: false })
    mockPermissionConfig.mockResolvedValue(null)
    mockEnterprisePlan.mockResolvedValue(true)
    setEnvFlags({ isInvitationsDisabled: false, isHosted: true, isBillingEnabled: true })
  })

  it.each([
    { role: 'owner', billing: true, denied: false, expected: true },
    { role: 'admin', billing: true, denied: true, expected: false },
    { role: 'member', billing: true, denied: false, expected: false },
    { role: 'member', billing: false, denied: false, expected: true },
    { role: 'member', billing: false, denied: true, expected: false },
  ])(
    'projects Build permission for $role with billing=$billing and denied=$denied',
    async ({ role, billing, denied, expected }) => {
      setEnvFlags({ isBillingEnabled: billing })
      queueTableRows(member, [{ role }])
      queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
      queueTableRows(member, [{ memberCount: 1 }])
      mockPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableWorkspaceCreation: denied,
      })
      expect(await getOrganizationSurfaceContext('org-1', 'viewer')).toMatchObject({
        canBuild: expected,
      })
    }
  )

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

  it.each([
    { disablePersonalApiKeys: false, disableOAuthAppAccess: false, allowed: true },
    { disablePersonalApiKeys: true, disableOAuthAppAccess: false, allowed: false },
    { disablePersonalApiKeys: false, disableOAuthAppAccess: true, allowed: false },
    { disablePersonalApiKeys: true, disableOAuthAppAccess: true, allowed: false },
  ])(
    'projects Search MCP policy as $allowed for %j',
    async ({ disablePersonalApiKeys, disableOAuthAppAccess, allowed }) => {
      queueTableRows(member, [{ role: 'member' }])
      queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
      queueTableRows(member, [{ memberCount: 1 }])
      mockPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disablePersonalApiKeys,
        disableOAuthAppAccess,
      })

      await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
        viewer: { canUseSearchMcp: allowed },
      })
      expect(mockPermissionConfig).toHaveBeenCalledWith('org-1')
    }
  )

  it('permits Search MCP when only managing API keys is disabled', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
    queueTableRows(member, [{ memberCount: 1 }])
    mockPermissionConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideApiKeysTab: true,
    })

    await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
      viewer: { canUsePersonalApiKeys: false, canUseSearchMcp: true },
    })
  })

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
    resetDbChainMock()
  })

  it('falls back to the earliest membership when the active organization is foreign', async () => {
    queueTableRows(member, [{ organizationId: 'org-1' }, { organizationId: 'org-2' }])

    await expect(resolveOrganizationLanding('viewer', 'org-other')).resolves.toBe('org-1')
  })
})

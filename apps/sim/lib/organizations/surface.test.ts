import { member, organization } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { credentialGroupsAvailabilityMock } from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

import {
  getOrganizationSurfaceContext,
  getOrganizationSurfaceGate,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const mockSearchAccess = knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability
const mockPermissionConfig =
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
const mockEnterprisePlan = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan

/** The nav lists Access Control on the regime; these tests drive it from the plan knob. */
permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive.mockImplementation(
  (...args: unknown[]) => mockEnterprisePlan(...args)
)

afterAll(resetDbChainMock)
afterAll(resetEnvFlagsMock)

describe('getOrganizationSurfaceGate', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockSearchAccess.mockReset().mockResolvedValue({ memberScoped: true, sourceMirrored: false })
    mockPermissionConfig.mockReset().mockResolvedValue(null)
    mockEnterprisePlan.mockReset().mockResolvedValue(true)
    setEnvFlags({ isInvitationsDisabled: false, isHosted: true, isBillingEnabled: true })
  })

  it('denies a non-member the same as the full context', async () => {
    queueTableRows(member, [])
    queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
    await expect(getOrganizationSurfaceGate('org-1', 'viewer')).resolves.toBeNull()
  })
})

describe('getOrganizationSurfaceContext', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockSearchAccess.mockResolvedValue({ memberScoped: true, sourceMirrored: false })
    mockPermissionConfig.mockResolvedValue(null)
    mockEnterprisePlan.mockResolvedValue(true)
    setEnvFlags({ isInvitationsDisabled: false, isHosted: true, isBillingEnabled: true })
  })

  it.each([
    { integrationsDenied: false, knowledgeDenied: false, allowed: true },
    { integrationsDenied: true, knowledgeDenied: false, allowed: false },
    { integrationsDenied: false, knowledgeDenied: true, allowed: false },
  ])(
    'respects Search connection permissions: %o',
    async ({ integrationsDenied, knowledgeDenied, allowed }) => {
      queueTableRows(member, [{ role: 'member' }])
      queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
      queueTableRows(member, [{ memberCount: 1 }])
      mockPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideIntegrationsTab: integrationsDenied,
        hideKnowledgeBaseTab: knowledgeDenied,
      })
      await expect(getOrganizationSurfaceContext('org-1', 'viewer')).resolves.toMatchObject({
        viewer: { canConnectSearchIntegrations: allowed },
      })
    }
  )

  it.each([
    {
      role: 'member',
      workspaceCreationDenied: false,
      chatDenied: false,
      chatOff: false,
      expected: true,
    },
    {
      role: 'member',
      workspaceCreationDenied: true,
      chatDenied: false,
      chatOff: false,
      expected: true,
    },
    {
      role: 'owner',
      workspaceCreationDenied: false,
      chatDenied: false,
      chatOff: false,
      expected: true,
    },
    {
      role: 'member',
      workspaceCreationDenied: false,
      chatDenied: true,
      chatOff: false,
      expected: false,
    },
    {
      role: 'owner',
      workspaceCreationDenied: false,
      chatDenied: true,
      chatOff: false,
      expected: false,
    },
    {
      role: 'owner',
      workspaceCreationDenied: false,
      chatDenied: false,
      chatOff: true,
      expected: false,
    },
  ])(
    'projects chat access from the permission group and deployment alone: %o',
    async ({ role, workspaceCreationDenied, chatDenied, chatOff, expected }) => {
      setEnvFlags({ isBillingEnabled: true, isChatEnabled: !chatOff })
      queueTableRows(member, [{ role }])
      queueTableRows(organization, [{ id: 'org-1', name: 'Acme', slug: 'acme', logo: null }])
      queueTableRows(member, [{ memberCount: 1 }])
      mockPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableWorkspaceCreation: workspaceCreationDenied,
        hideCopilot: chatDenied,
      })
      try {
        expect(await getOrganizationSurfaceContext('org-1', 'viewer')).toMatchObject({
          mothershipAvailable: expected,
        })
      } finally {
        setEnvFlags({ isChatEnabled: true })
      }
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

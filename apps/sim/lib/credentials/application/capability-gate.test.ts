/**
 * @vitest-environment node
 *
 * The current-user credential operations govern listing and disconnecting a
 * user's OAuth connections. They are minted by `defineCredentialUserOperation`,
 * which does not call `defineWorkspaceOperation`, so `authorizeWorkspaceOperation`
 * never sees them and they shipped with no capability at all — a member whose
 * group revokes Integrations could still enumerate and disconnect every
 * connection. These pin the gate through the real routes, so the refusal the
 * caller actually receives is what is asserted.
 *
 * They have no workspace, so the gate resolves the organization's default group
 * — the same resolution personal API keys use for an organization-level action.
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserOrganization,
  mockGetOrgPermissionConfig,
  mockListOAuthConnectionsForUser,
  mockListConnectedAccountsForUser,
  mockDisconnectOAuthAccounts,
} = vi.hoisted(() => ({
  mockGetUserOrganization: vi.fn(),
  mockGetOrgPermissionConfig: vi.fn(),
  mockListOAuthConnectionsForUser: vi.fn(),
  mockListConnectedAccountsForUser: vi.fn(),
  mockDisconnectOAuthAccounts: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: vi.fn(),
  getUserPermissionConfigForOrganization: mockGetOrgPermissionConfig,
  resolveVerifiedUserAccessControlContext: vi.fn(),
}))

vi.mock('@/lib/credentials/oauth-accounts', () => ({
  listOAuthConnectionsForUser: mockListOAuthConnectionsForUser,
  listConnectedAccountsForUser: mockListConnectedAccountsForUser,
  disconnectOAuthAccounts: mockDisconnectOAuthAccounts,
  OAuthDisconnectPartialFailureError: class OAuthDisconnectPartialFailureError extends Error {
    credentials: unknown[] = []
  },
  OAuthDisconnectLimitError: class OAuthDisconnectLimitError extends Error {},
  OAuthDisconnectConfigurationError: class OAuthDisconnectConfigurationError extends Error {},
  OAuthProviderRevocationError: class OAuthProviderRevocationError extends Error {},
}))

import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as listConnectedAccounts } from '@/app/api/auth/accounts/route'
import { GET as listConnections } from '@/app/api/auth/oauth/connections/route'
import { POST as disconnect } from '@/app/api/auth/oauth/disconnect/route'

const USER_ID = 'user-1'
const ORGANIZATION_ID = 'org-1'

const mockGetSession = authMockFns.mockGetSession

function callListConnections() {
  return listConnections(createMockRequest('GET'), { params: Promise.resolve({}) })
}

function callListConnectedAccounts() {
  return listConnectedAccounts(
    createMockRequest('GET', undefined, {}, 'http://localhost/api/auth/accounts'),
    { params: Promise.resolve({}) }
  )
}

function callDisconnect() {
  return disconnect(createMockRequest('POST', { provider: 'google' }), {
    params: Promise.resolve({}),
  })
}

const INTEGRATIONS_REFUSAL = capabilityRefusal('integrations.manage')

describe('integrations.manage gate on the current-user credential operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: USER_ID },
      session: { id: 'session-1' },
    })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      role: 'member',
      memberId: 'member-1',
    })
    mockGetOrgPermissionConfig.mockResolvedValue(null)
    mockListOAuthConnectionsForUser.mockResolvedValue([])
    mockListConnectedAccountsForUser.mockResolvedValue([])
    mockDisconnectOAuthAccounts.mockResolvedValue({
      credentials: [],
      provider: 'google',
      providerId: undefined,
    })
  })

  describe('when the group withholds Integrations', () => {
    beforeEach(() => {
      mockGetOrgPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideIntegrationsTab: true,
      })
    })

    it('refuses to enumerate the OAuth connections, and never reads them', async () => {
      const response = await callListConnections()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: INTEGRATIONS_REFUSAL })
      expect(mockListOAuthConnectionsForUser).not.toHaveBeenCalled()
    })

    it('refuses to list the connected accounts, and never reads them', async () => {
      const response = await callListConnectedAccounts()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: INTEGRATIONS_REFUSAL })
      expect(mockListConnectedAccountsForUser).not.toHaveBeenCalled()
    })

    it('refuses the disconnect, and never deletes a credential', async () => {
      const response = await callDisconnect()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: INTEGRATIONS_REFUSAL })
      expect(mockDisconnectOAuthAccounts).not.toHaveBeenCalled()
    })

    /**
     * Concealment: authentication still runs first, so an unauthenticated
     * caller is told to authenticate rather than told how someone else's
     * organization is configured.
     */
    it('still answers an unauthenticated caller with 401, not the capability', async () => {
      mockGetSession.mockResolvedValue(null)

      const response = await callListConnections()

      expect(response.status).toBe(401)
      expect(mockGetOrgPermissionConfig).not.toHaveBeenCalled()
    })
  })

  describe('when no group governs the caller', () => {
    it('lists the OAuth connections', async () => {
      const response = await callListConnections()

      expect(response.status).toBe(200)
      expect(mockListOAuthConnectionsForUser).toHaveBeenCalledWith(USER_ID)
    })

    it('disconnects', async () => {
      const response = await callDisconnect()

      expect(response.status).toBe(200)
      expect(mockDisconnectOAuthAccounts).toHaveBeenCalledTimes(1)
    })

    /**
     * The personal-workspace case: a user in no organization has no group to
     * resolve, so the gate is a no-op and never asks.
     */
    it('does not even resolve a group for a user in no organization', async () => {
      mockGetUserOrganization.mockResolvedValue(null)

      const response = await callListConnections()

      expect(response.status).toBe(200)
      expect(mockGetOrgPermissionConfig).not.toHaveBeenCalled()
    })
  })

  describe('when a group governs the caller but permits Integrations', () => {
    it('lets the disconnect through', async () => {
      mockGetOrgPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideSecretsTab: true,
      })

      const response = await callDisconnect()

      expect(response.status).toBe(200)
      expect(mockDisconnectOAuthAccounts).toHaveBeenCalledTimes(1)
    })
  })
})

/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import {
  dbChainMockFns,
  hybridAuthMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
  resetPermissionGroupScopeMock,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

const { mockGetCredentialActorContext, mockCanUseCredential } = vi.hoisted(() => ({
  mockGetCredentialActorContext: vi.fn(),
  mockCanUseCredential: vi.fn(() => true),
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
  canUseCredential: mockCanUseCredential,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET } from '@/app/api/auth/oauth/credentials/route'

describe('OAuth Credentials API Route', () => {
  function createMockRequestWithQuery(method = 'GET', queryParams = ''): NextRequest {
    const url = `http://localhost:3000/api/auth/oauth/credentials${queryParams}`
    return new NextRequest(new URL(url), { method })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resetPermissionGroupScopeMock()
    mockCanUseCredential.mockReturnValue(true)
  })

  it('should handle unauthenticated user', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
  })

  it('should handle missing provider parameter', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
  })

  it('should handle no credentials found', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=github')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should return empty credentials when no workspace context', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google-email')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('does not expose a managed credential requested by exact ID', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'managed-credential-1',
        workspaceId: 'workspace-1',
        type: 'managed_oauth',
        displayName: 'Managed Gmail',
        providerId: 'google-email',
        accountId: null,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        accountProviderId: null,
        accountScope: null,
        accountUpdatedAt: null,
      },
    ])

    const response = await GET(
      createMockRequestWithQuery('GET', '?credentialId=managed-credential-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ credentials: [] })
  })

  /**
   * The split this route exists to make. It authenticates through
   * `checkSessionOrInternalAuth`, so one handler answers both a person opening
   * the credential selector and the executor resolving a credential mid-run.
   * Gating both would 403 a deployed workflow whose group permits it, hours
   * after an admin ticked a box and with nothing connecting the two.
   */
  describe('integrations.manage', () => {
    const INTEGRATIONS_WITHHELD = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideIntegrationsTab: true,
    }

    /**
     * `mockResolvedValue`, not `...Once`: the missing-provider test above
     * returns 400 before authentication runs, so its queued value is never
     * consumed and every later `...Once` in this file reads one test stale.
     */
    function authenticatedAs(authType: 'session' | 'internal_jwt') {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-123',
        authType,
      })
    }

    function governedBy(config: typeof DEFAULT_PERMISSION_GROUP_CONFIG) {
      permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(config)
    }

    function callWithWorkspace() {
      return GET(
        createMockRequestWithQuery(
          'GET',
          '?provider=google-email&workspaceId=3f1c8a54-1c2e-4a1b-9d6e-2b7c5a9f0e11'
        )
      )
    }

    beforeEach(() => {
      authenticatedAs('session')
      permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
        exists: true,
        hasAccess: true,
        canWrite: true,
        canAdmin: true,
      })
    })

    it('refuses a session whose group withholds Integrations', async () => {
      governedBy(INTEGRATIONS_WITHHELD)

      const response = await callWithWorkspace()

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("your organization's permission group"),
      })
    })

    /**
     * The one that matters. A run resolving its credential must not be refused
     * by a group that describes what a person may open.
     */
    it('does not refuse the executor under the same withholding group', async () => {
      authenticatedAs('internal_jwt')
      governedBy(INTEGRATIONS_WITHHELD)
      dbChainMockFns.where.mockResolvedValue([])

      const response = await callWithWorkspace()

      expect(response.status).toBe(200)
      expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
    })

    it('allows a session whose group leaves Integrations alone', async () => {
      governedBy(DEFAULT_PERMISSION_GROUP_CONFIG)
      dbChainMockFns.where.mockResolvedValue([])

      const response = await callWithWorkspace()

      expect(response.status).toBe(200)
    })

    /**
     * A `credentialId` lookup can arrive with no workspace in the query, so the
     * gate above never runs; the credential names the workspace whose group
     * governs it.
     */
    it('refuses a session credentialId lookup using the credential own workspace', async () => {
      governedBy(INTEGRATIONS_WITHHELD)
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          id: 'credential-1',
          workspaceId: 'workspace-1',
          type: 'oauth',
          displayName: 'Gmail',
          providerId: 'google-email',
          accountId: 'account-1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          accountProviderId: 'google-email',
          accountScope: 'email',
          accountUpdatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ])

      const response = await GET(createMockRequestWithQuery('GET', '?credentialId=credential-1'))

      expect(response.status).toBe(403)
      expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).toHaveBeenCalledWith(
        'user-123',
        'workspace-1',
        undefined
      )
    })
  })
})

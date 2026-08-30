/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockCreateApproval,
  mockEnforceUserRateLimit,
  mockGetPermissions,
  mockGetUserPermissionConfig,
  mockGetOrgPermissionConfig,
  mockResolveVerifiedContext,
  mockGetUserOrganization,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateApproval: vi.fn(),
  mockEnforceUserRateLimit: vi.fn(),
  mockGetPermissions: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockGetOrgPermissionConfig: vi.fn(),
  mockResolveVerifiedContext: vi.fn(),
  mockGetUserOrganization: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization: mockGetOrgPermissionConfig,
  resolveVerifiedUserAccessControlContext: mockResolveVerifiedContext,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/cli-auth/approval-store', () => ({
  createApproval: mockCreateApproval,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetPermissions,
}))

import { POST } from '@/app/api/cli/auth/approve/route'

const REQUEST = 'a'.repeat(43)
const CHALLENGE = createHash('sha256').update('b'.repeat(43)).digest('base64url')

describe('POST /api/cli/auth/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockCreateApproval.mockResolvedValue(undefined)
    mockGetPermissions.mockResolvedValue('admin')
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockGetOrgPermissionConfig.mockResolvedValue(null)
    mockGetUserOrganization.mockResolvedValue({ organizationId: 'org-1' })
  })

  it('refuses an approver whose permission group disables CLI access', async () => {
    mockGetOrgPermissionConfig.mockResolvedValue({ disableCliAccess: true })

    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )

    expect(response.status).toBe(403)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('resolves the governing group from the bound workspace when one is given', async () => {
    await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
        bindKeyToWorkspace: true,
      })
    )

    expect(mockGetUserPermissionConfig).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(mockGetOrgPermissionConfig).not.toHaveBeenCalled()
  })

  it('records the approval for the signed-in user', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'copilot',
      workspaceId: undefined,
      workspaceBound: false,
    })
  })

  it('defaults to the copilot scope so pre-scope terminals keep working', async () => {
    await POST(createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE }))
    expect(mockCreateApproval).toHaveBeenCalledWith(
      'user-1',
      REQUEST,
      CHALLENGE,
      expect.objectContaining({ scope: 'copilot' })
    )
  })

  it('records a workspace binding when the approver is a workspace admin', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(200)
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: true,
    })
  })

  it("records a non-admin's pick as a default without binding the key to it", async () => {
    mockGetPermissions.mockResolvedValue('write')
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(200)
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: false,
    })
  })

  it('refuses to bind a key to a workspace the approver is not admin of', async () => {
    mockGetPermissions.mockResolvedValue('write')
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(403)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses a workspace the approver is not a member of', async () => {
    mockGetPermissions.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(404)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses bindKeyToWorkspace with no workspaceId', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses a workspace binding on the copilot scope', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'copilot',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  /**
   * The workspace-key pass-through in the authorization funnel resolves no
   * group, so minting one is the only place the regime can be enforced. The
   * workspaces API-keys route gates it; these prove the terminal does too.
   */
  describe('api_keys.manage', () => {
    const REFUSAL = "Managing API keys is not available under your organization's permission group"

    it('refuses to record a workspace-bound approval when the workspace group withholds it', async () => {
      mockGetUserPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
          bindKeyToWorkspace: true,
        })
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: REFUSAL })
      expect(mockCreateApproval).not.toHaveBeenCalled()
    })

    it('refuses a personal platform approval when the organization group withholds it', async () => {
      mockGetOrgPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, scope: 'platform' })
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: REFUSAL })
      expect(mockCreateApproval).not.toHaveBeenCalled()
    })

    it('reads the organization group for an unbound approval that still names a workspace', async () => {
      // The workspace is only the terminal's default here, so the key is
      // personal and the organization's group is the one that governs it.
      mockGetPermissions.mockResolvedValue('write')
      mockGetOrgPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
        })
      )

      expect(response.status).toBe(403)
      expect(mockCreateApproval).not.toHaveBeenCalled()
    })

    it('leaves a copilot approval alone — a separate key space the API-keys surface never manages', async () => {
      mockGetOrgPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, scope: 'copilot' })
      )

      expect(response.status).toBe(200)
      expect(mockCreateApproval).toHaveBeenCalled()
    })

    it('records the approval when a governing group permits key management', async () => {
      mockGetUserPermissionConfig.mockResolvedValue({ hideApiKeysTab: false })

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
          bindKeyToWorkspace: true,
        })
      )

      expect(response.status).toBe(200)
      expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
        scope: 'platform',
        workspaceId: 'ws-1',
        workspaceBound: true,
      })
    })

    it('leaves a user no group governs unaffected', async () => {
      mockGetUserPermissionConfig.mockResolvedValue(null)
      mockGetOrgPermissionConfig.mockResolvedValue(null)
      mockGetUserOrganization.mockResolvedValue(null)

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
          bindKeyToWorkspace: true,
        })
      )

      expect(response.status).toBe(200)
      expect(mockCreateApproval).toHaveBeenCalled()
    })

    it('refuses after the role check, so a non-admin still learns nothing about the group', async () => {
      mockGetPermissions.mockResolvedValue('write')
      mockGetUserPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
          bindKeyToWorkspace: true,
        })
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: 'Workspace admin permission is required to issue a workspace API key',
      })
    })

    it('reports the coarser CLI refusal when the group withholds both', async () => {
      mockGetUserPermissionConfig.mockResolvedValue({
        disableCliAccess: true,
        hideApiKeysTab: true,
      })

      const response = await POST(
        createMockRequest('POST', {
          request: REQUEST,
          challenge: CHALLENGE,
          scope: 'platform',
          workspaceId: 'ws-1',
          bindKeyToWorkspace: true,
        })
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: "CLI access is not available under your organization's permission group",
      })
    })
  })

  it('rejects an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(401)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('ignores a user id supplied in the body', async () => {
    await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, userId: 'attacker' })
    )
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, expect.anything())
  })

  it('rejects a malformed challenge', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: 'not-a-digest' })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })
})

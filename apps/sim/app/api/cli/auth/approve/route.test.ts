import { createHash } from 'node:crypto'
import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateApproval } = vi.hoisted(() => ({
  mockCreateApproval: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/cli-auth/approval-store', () => ({
  createApproval: mockCreateApproval,
}))

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/cli/auth/approve/route'

const mockEnforceUserRateLimit = rateLimiterMockFns.mockEnforceUserRateLimit
const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
const mockGetOrgPermissionConfig =
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
const mockGetPermissions = permissionsMockFns.mockGetUserEntityPermissions
const mockGetUserOrganization = organizationMembershipMockFns.mockGetUserOrganization
const mockGetSession = authMockFns.mockGetSession

const REQUEST = 'a'.repeat(43)
const CHALLENGE = createHash('sha256').update('b'.repeat(43)).digest('base64url')

describe('POST /api/cli/auth/approve', () => {
  beforeEach(() => {
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

    it('leaves a copilot approval alone — a separate key space the API-keys surface never manages', async () => {
      mockGetOrgPermissionConfig.mockResolvedValue({ hideApiKeysTab: true })

      const response = await POST(
        createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, scope: 'copilot' })
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

  it('ignores a user id supplied in the body', async () => {
    await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, userId: 'attacker' })
    )
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, expect.anything())
  })
})

/**
 * @vitest-environment node
 *
 * `GET /api/credentials/memberships` names no workspace, so its own gate reads
 * the caller's organization default group. Every credential it returns does name
 * one (`credential.workspace_id` is NOT NULL), and `credentials.list` withholds
 * those same rows inside the workspace under `integrations.manage`. These pin
 * that the user-global listing is not the way back to what the workspace-scoped
 * listing hides — projected against this user's own group in each workspace,
 * never a bystander's — and that leaving a membership stays available.
 */
import { authMockFns, createMockRequest, permissionGroupScopeMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserOrganization, mockGetOrgPermissionConfig, mockList, mockLeave } = vi.hoisted(
  () => ({
    mockGetUserOrganization: vi.fn(),
    mockGetOrgPermissionConfig: vi.fn(),
    mockList: vi.fn(),
    mockLeave: vi.fn(),
  })
)

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: vi.fn(),
  getUserPermissionConfigForOrganization: mockGetOrgPermissionConfig,
  resolveVerifiedUserAccessControlContext: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/credentials/members', () => ({
  leaveCredentialMembership: mockLeave,
  listCredentialMembers: vi.fn(),
  listCredentialMembershipsForUser: mockList,
  removeCredentialMember: vi.fn(),
  upsertCredentialMember: vi.fn(),
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { DELETE, GET } from '@/app/api/credentials/memberships/route'

const USER_ID = 'user-1'
const GOVERNED_WORKSPACE = 'workspace-governed'
const OPEN_WORKSPACE = 'workspace-open'

const mockGetSession = authMockFns.mockGetSession
const mockResolveConfig = permissionGroupScopeMock.resolvePermissionGroupConfig

function membership(id: string, workspaceId: string) {
  return {
    membershipId: `membership-${id}`,
    credentialId: id,
    workspaceId,
    type: 'oauth' as const,
    displayName: id,
    providerId: 'google',
    role: 'member' as const,
    status: 'active' as const,
    joinedAt: null,
  }
}

function callList() {
  return GET(
    createMockRequest('GET', undefined, {}, 'http://localhost/api/credentials/memberships'),
    { params: Promise.resolve({}) }
  )
}

function callLeave(credentialId: string) {
  return DELETE(
    createMockRequest(
      'DELETE',
      undefined,
      {},
      `http://localhost/api/credentials/memberships?credentialId=${credentialId}`
    ),
    { params: Promise.resolve({}) }
  )
}

describe('credential membership listing under a workspace group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveConfig.mockReset()
    mockGetSession.mockResolvedValue({ user: { id: USER_ID }, session: { id: 'session-1' } })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockGetOrgPermissionConfig.mockResolvedValue(null)
    mockList.mockResolvedValue([
      membership('cred-governed', GOVERNED_WORKSPACE),
      membership('cred-open', OPEN_WORKSPACE),
    ])
    mockLeave.mockResolvedValue(undefined)
    mockResolveConfig.mockImplementation(async (_userId: string, workspaceId: string) =>
      workspaceId === GOVERNED_WORKSPACE
        ? { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideIntegrationsTab: true }
        : null
    )
  })

  it('drops the rows whose workspace withholds Integrations from this user', async () => {
    const response = await callList()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.memberships.map((row: { credentialId: string }) => row.credentialId)).toEqual([
      'cred-open',
    ])
  })

  it('resolves the group as the caller themself, in each credential’s workspace', async () => {
    await callList()

    expect(mockResolveConfig).toHaveBeenCalledWith(USER_ID, GOVERNED_WORKSPACE, undefined)
    expect(mockResolveConfig).toHaveBeenCalledWith(USER_ID, OPEN_WORKSPACE, undefined)
  })

  it('asks once per workspace, not once per credential', async () => {
    mockList.mockResolvedValue([
      membership('cred-a', GOVERNED_WORKSPACE),
      membership('cred-b', GOVERNED_WORKSPACE),
      membership('cred-c', OPEN_WORKSPACE),
    ])

    await callList()

    expect(mockResolveConfig).toHaveBeenCalledTimes(2)
  })

  it('returns every row when no group governs the caller anywhere', async () => {
    mockResolveConfig.mockResolvedValue(null)

    const response = await callList()

    const body = await response.json()
    expect(body.memberships).toHaveLength(2)
  })

  /**
   * Leaving revokes the caller's own access and grants nothing, so a workspace
   * that hides the module must not strand them inside the share.
   */
  it('still lets the member leave a credential in the withholding workspace', async () => {
    const response = await callLeave('cred-governed')

    expect(response.status).toBe(200)
    expect(mockLeave).toHaveBeenCalledWith({ userId: USER_ID, credentialId: 'cred-governed' })
  })
})

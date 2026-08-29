/**
 * @vitest-environment node
 */
import { member } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetOrgPermissionConfig,
  mockGetUserPermissionConfig,
  mockResolveVerifiedContext,
  mockGetUsageSnapshot,
} = vi.hoisted(() => ({
  mockGetOrgPermissionConfig: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockResolveVerifiedContext: vi.fn(),
  mockGetUsageSnapshot: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string | null | undefined) => role === 'owner' || role === 'admin',
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization: mockGetOrgPermissionConfig,
  resolveVerifiedUserAccessControlContext: mockResolveVerifiedContext,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationMemberUsageSnapshot: mockGetUsageSnapshot,
}))

import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { GET } from '@/app/api/organizations/[id]/members/route'

const mockGetSession = authMockFns.mockGetSession

const REQUEST_URL = 'http://localhost/api/organizations/org-1/members'

function request() {
  return GET(createMockRequest('GET', undefined, {}, REQUEST_URL), {
    params: Promise.resolve({ id: 'org-1' }),
  })
}

afterAll(resetDbChainMock)

describe('GET /api/organizations/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue(createSession({ userId: 'user-reader' }))
    mockGetOrgPermissionConfig.mockResolvedValue(null)
  })

  it('lists members for an organization member', async () => {
    queueTableRows(member, [{ id: 'member-reader', role: 'member' }])
    queueTableRows(member, [
      {
        id: 'member-admin',
        userId: 'user-admin',
        organizationId: 'org-1',
        role: 'admin',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        userName: 'Admin User',
        userEmail: 'admin@example.com',
      },
    ])
    queueTableRows(member, [{ value: 1 }])

    const response = await request()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].userEmail).toBe('admin@example.com')
  })

  it('refuses a member whose permission group hides the member directory', async () => {
    mockGetOrgPermissionConfig.mockResolvedValue({ hideOrgMemberDirectory: true })
    queueTableRows(member, [{ id: 'member-reader', role: 'member' }])

    const response = await request()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: capabilityRefusal('organization.member_directory'),
    })
  })
})

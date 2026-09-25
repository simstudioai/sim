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

vi.mock('@/lib/permission-groups/resolve.server', () => ({
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
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'user-reader' }),
      session: { id: 'session-reader' },
    })
    mockGetOrgPermissionConfig.mockResolvedValue(null)
  })

  it('refuses a member whose permission group hides the member directory', async () => {
    mockGetOrgPermissionConfig.mockResolvedValue({ hideOrgMemberDirectory: true })
    queueTableRows(member, [{ id: 'member-reader', role: 'member' }])

    const response = await request()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: capabilityRefusal('organization.member_directory'),
    })
  })
})

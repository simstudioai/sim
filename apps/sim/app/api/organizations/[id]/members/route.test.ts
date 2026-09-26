import { member } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { billingOrganizationMock } from '@sim/testing/mocks/billing-organization.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)

import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { GET } from '@/app/api/organizations/[id]/members/route'

const mockGetSession = authMockFns.mockGetSession
const mockGetOrgPermissionConfig =
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization

const REQUEST_URL = 'http://localhost/api/organizations/org-1/members'

function request() {
  return GET(
    createMockRequest('GET', undefined, {}, REQUEST_URL),
    createRouteContext({ id: 'org-1' })
  )
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

/**
 * @vitest-environment node
 *
 * Tests for GET /api/v1/audit-logs/[id] — verifies the lookup is constrained
 * by the organization scope and 404s for rows outside it.
 */
import { createMockRequest, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateEnterpriseAuditAccess,
  mockBuildOrgScopeCondition,
  mockGetOrgWorkspaceIds,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateEnterpriseAuditAccess: vi.fn(),
  mockBuildOrgScopeCondition: vi.fn(),
  mockGetOrgWorkspaceIds: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(),
}))

vi.mock('@/app/api/v1/audit-logs/auth', () => ({
  validateEnterpriseAuditAccess: mockValidateEnterpriseAuditAccess,
}))

vi.mock('@/app/api/v1/audit-logs/query', () => ({
  buildOrgScopeCondition: mockBuildOrgScopeCondition,
  getOrgWorkspaceIds: mockGetOrgWorkspaceIds,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

import { GET } from '@/app/api/v1/audit-logs/[id]/route'

const ORG_ID = 'org-1'
const MEMBER_IDS = ['admin-1', 'member-1']
const ORG_WORKSPACE_IDS = ['ws-org-1']
const SCOPE_SENTINEL = { type: 'org-scope-sentinel' }

const AUDIT_ROW = {
  id: 'log-1',
  workspaceId: 'ws-org-1',
  actorId: 'member-1',
  actorName: 'Member',
  actorEmail: 'member@example.com',
  action: 'workflow.created',
  resourceType: 'workflow',
  resourceId: 'wf-1',
  resourceName: 'My Workflow',
  description: 'Created workflow',
  metadata: {},
  ipAddress: '127.0.0.1',
  userAgent: 'test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

function callRoute(id: string) {
  const request = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v1/audit-logs/${id}`
  )
  return GET(request, { params: Promise.resolve({ id }) })
}

describe('GET /api/v1/audit-logs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'admin-1' })
    mockValidateEnterpriseAuditAccess.mockResolvedValue({
      success: true,
      context: { organizationId: ORG_ID, orgMemberIds: MEMBER_IDS },
    })
    mockGetOrgWorkspaceIds.mockResolvedValue(ORG_WORKSPACE_IDS)
    mockBuildOrgScopeCondition.mockReturnValue(SCOPE_SENTINEL)
  })

  it('constrains the lookup with the org scope condition (includeDeparted)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([AUDIT_ROW])

    const response = await callRoute('log-1')

    expect(response.status).toBe(200)
    expect(mockBuildOrgScopeCondition).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      orgWorkspaceIds: ORG_WORKSPACE_IDS,
      orgMemberIds: MEMBER_IDS,
      includeDeparted: true,
    })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([SCOPE_SENTINEL]),
      })
    )
  })

  it('returns 404 when the row is outside the organization scope', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await callRoute('log-outside-org')

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Audit log not found')
  })

  it('excludes ipAddress and userAgent from the response', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([AUDIT_ROW])

    const response = await callRoute('log-1')
    const body = await response.json()

    expect(body.data.id).toBe('log-1')
    expect(body.data.ipAddress).toBeUndefined()
    expect(body.data.userAgent).toBeUndefined()
  })
})

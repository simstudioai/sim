/**
 * @vitest-environment node
 *
 * Tests for GET /api/v1/audit-logs — verifies filters are validated against
 * the caller's organization and the scope is built from the org context.
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateEnterpriseAuditAccess,
  mockBuildOrgScopeCondition,
  mockGetOrgWorkspaceIds,
  mockQueryAuditLogs,
  mockBuildFilterConditions,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateEnterpriseAuditAccess: vi.fn(),
  mockBuildOrgScopeCondition: vi.fn(),
  mockGetOrgWorkspaceIds: vi.fn(),
  mockQueryAuditLogs: vi.fn(),
  mockBuildFilterConditions: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(),
}))

vi.mock('@/app/api/v1/audit-logs/auth', () => ({
  validateEnterpriseAuditAccess: mockValidateEnterpriseAuditAccess,
}))

vi.mock('@/app/api/v1/audit-logs/query', () => ({
  buildFilterConditions: mockBuildFilterConditions,
  buildOrgScopeCondition: mockBuildOrgScopeCondition,
  getOrgWorkspaceIds: mockGetOrgWorkspaceIds,
  queryAuditLogs: mockQueryAuditLogs,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

import { GET } from '@/app/api/v1/audit-logs/route'

const ORG_ID = 'org-1'
const MEMBER_IDS = ['admin-1', 'member-1']
const ORG_WORKSPACE_IDS = ['ws-org-1', 'ws-org-2']
const SCOPE_SENTINEL = { type: 'org-scope-sentinel' }

function makeRequest(query: string) {
  return createMockRequest('GET', undefined, {}, `http://localhost:3000/api/v1/audit-logs${query}`)
}

describe('GET /api/v1/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'admin-1' })
    mockValidateEnterpriseAuditAccess.mockResolvedValue({
      success: true,
      context: { organizationId: ORG_ID, orgMemberIds: MEMBER_IDS },
    })
    mockGetOrgWorkspaceIds.mockResolvedValue(ORG_WORKSPACE_IDS)
    mockBuildOrgScopeCondition.mockReturnValue(SCOPE_SENTINEL)
    mockBuildFilterConditions.mockReturnValue([])
    mockQueryAuditLogs.mockResolvedValue({ data: [], nextCursor: undefined })
  })

  it('rejects an actorId that is not a current org member', async () => {
    const response = await GET(makeRequest('?actorId=outsider-1'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('actorId is not a member of your organization')
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })

  it('rejects a workspaceId that does not belong to the organization', async () => {
    const response = await GET(makeRequest('?workspaceId=ws-other-org'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('workspaceId does not belong to your organization')
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })

  it('accepts a workspaceId that belongs to the organization', async () => {
    const response = await GET(makeRequest('?workspaceId=ws-org-1'))

    expect(response.status).toBe(200)
    expect(mockQueryAuditLogs).toHaveBeenCalled()
  })

  it('builds the scope from the organization context, never from actors alone', async () => {
    const response = await GET(makeRequest('?actorId=member-1'))

    expect(response.status).toBe(200)
    expect(mockBuildOrgScopeCondition).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      orgWorkspaceIds: ORG_WORKSPACE_IDS,
      orgMemberIds: MEMBER_IDS,
      includeDeparted: false,
    })

    const [conditions] = mockQueryAuditLogs.mock.calls[0]
    expect(conditions[0]).toBe(SCOPE_SENTINEL)
  })

  it('passes includeDeparted through to the scope builder', async () => {
    const response = await GET(makeRequest('?includeDeparted=true'))

    expect(response.status).toBe(200)
    expect(mockBuildOrgScopeCondition).toHaveBeenCalledWith(
      expect.objectContaining({ includeDeparted: true })
    )
  })

  it('returns the auth failure response when enterprise access is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'nope' }), { status: 403 })
    mockValidateEnterpriseAuditAccess.mockResolvedValue({ success: false, response: denied })

    const response = await GET(makeRequest(''))

    expect(response.status).toBe(403)
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })
})

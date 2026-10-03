/**
 * Tests for GET /api/v1/audit-logs — verifies filters are validated against
 * the caller's organization and the scope is built from the org context.
 */
import { createMockRequest } from '@sim/testing'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockValidateV1EnterpriseAuditAccess,
  mockBuildOrgScopeCondition,
  mockGetOrgWorkspaceIds,
  mockQueryAuditLogs,
  mockBuildFilterConditions,
} = vi.hoisted(() => ({
  mockValidateV1EnterpriseAuditAccess: vi.fn(),
  mockBuildOrgScopeCondition: vi.fn(),
  mockGetOrgWorkspaceIds: vi.fn(),
  mockQueryAuditLogs: vi.fn(),
  mockBuildFilterConditions: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/app/api/v1/audit-logs/auth', () => ({
  validateV1EnterpriseAuditAccess: mockValidateV1EnterpriseAuditAccess,
}))

vi.mock('@/lib/audit-logs/query', () => ({
  buildFilterConditions: mockBuildFilterConditions,
  buildOrgScopeCondition: mockBuildOrgScopeCondition,
  getOrgWorkspaceIds: mockGetOrgWorkspaceIds,
  queryAuditLogs: mockQueryAuditLogs,
}))

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

import { GET } from '@/app/api/v1/audit-logs/route'

const { mockCheckRateLimit } = v1MiddlewareMockFns

v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))

const ORG_ID = 'org-1'
const MEMBER_IDS = ['admin-1', 'member-1']
const ORG_WORKSPACE_IDS = ['ws-org-1', 'ws-org-2']
const SCOPE_SENTINEL = { type: 'org-scope-sentinel' }

function makeRequest(query: string) {
  return createMockRequest('GET', undefined, {}, `http://localhost:3000/api/v1/audit-logs${query}`)
}

describe('GET /api/v1/audit-logs', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'admin-1' })
    mockValidateV1EnterpriseAuditAccess.mockResolvedValue({
      success: true,
      userId: 'admin-1',
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

  it('returns the refusal for a workspace key without querying', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      userId: 'admin-1',
      keyType: 'workspace',
      workspaceId: 'ws-org-1',
    })
    const denied = new Response(
      JSON.stringify({ error: 'Audit logs require a personal API key' }),
      {
        status: 403,
      }
    )
    mockValidateV1EnterpriseAuditAccess.mockResolvedValue({ success: false, response: denied })

    const response = await GET(makeRequest('?workspaceId=ws-org-2'))

    expect(response.status).toBe(403)
    expect(mockValidateV1EnterpriseAuditAccess).toHaveBeenCalledWith(
      expect.objectContaining({ keyType: 'workspace' })
    )
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })
})

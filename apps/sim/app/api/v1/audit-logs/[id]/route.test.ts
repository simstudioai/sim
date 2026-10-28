/**
 * Tests for GET /api/v1/audit-logs/[id] — verifies the lookup is constrained
 * by the organization scope and 404s for rows outside it.
 */
import { createMockRequest, dbChainMockFns } from '@sim/testing'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockValidateV1EnterpriseAuditAccess, mockBuildOrgScopeCondition, mockGetOrgWorkspaceIds } =
  vi.hoisted(() => ({
    mockValidateV1EnterpriseAuditAccess: vi.fn(),
    mockBuildOrgScopeCondition: vi.fn(),
    mockGetOrgWorkspaceIds: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/app/api/v1/audit-logs/auth', () => ({
  validateV1EnterpriseAuditAccess: mockValidateV1EnterpriseAuditAccess,
}))

vi.mock('@/lib/audit-logs/query', () => ({
  buildOrgScopeCondition: mockBuildOrgScopeCondition,
  getOrgWorkspaceIds: mockGetOrgWorkspaceIds,
}))

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

import { GET } from '@/app/api/v1/audit-logs/[id]/route'

const { mockCheckRateLimit } = v1MiddlewareMockFns

v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))

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
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'admin-1' })
    mockValidateV1EnterpriseAuditAccess.mockResolvedValue({
      success: true,
      userId: 'admin-1',
      context: { organizationId: ORG_ID, orgMemberIds: MEMBER_IDS },
    })
    mockGetOrgWorkspaceIds.mockResolvedValue(ORG_WORKSPACE_IDS)
    mockBuildOrgScopeCondition.mockReturnValue(SCOPE_SENTINEL)
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

    const response = await callRoute('log-1')

    expect(response.status).toBe(403)
    expect(mockValidateV1EnterpriseAuditAccess).toHaveBeenCalledWith(
      expect.objectContaining({ keyType: 'workspace' })
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

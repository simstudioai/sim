/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveEnterpriseAuditAccess,
  mockBuildFilterConditions,
  mockBuildOrgScopeCondition,
  mockGetOrgWorkspaceIds,
  mockQueryAuditLogs,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveEnterpriseAuditAccess: vi.fn(),
  mockBuildFilterConditions: vi.fn(),
  mockBuildOrgScopeCondition: vi.fn(),
  mockGetOrgWorkspaceIds: vi.fn(),
  mockQueryAuditLogs: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/app/api/v1/audit-logs/auth', () => ({
  resolveEnterpriseAuditAccess: mockResolveEnterpriseAuditAccess,
}))

vi.mock('@/app/api/v1/audit-logs/query', () => ({
  buildFilterConditions: mockBuildFilterConditions,
  buildOrgScopeCondition: mockBuildOrgScopeCondition,
  getOrgWorkspaceIds: mockGetOrgWorkspaceIds,
  queryAuditLogs: mockQueryAuditLogs,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/audit-logs/route'

const RATE_LIMIT = {
  allowed: true,
  userId: 'admin-1',
  keyType: 'personal',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-01T00:00:00Z'),
}

function callGet(query = '') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/audit-logs${query}`))
}

describe('GET /api/v2/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveEnterpriseAuditAccess.mockResolvedValue({
      success: true,
      context: { organizationId: 'org-1', orgMemberIds: ['admin-1'] },
    })
    mockGetOrgWorkspaceIds.mockResolvedValue([])
    mockBuildOrgScopeCondition.mockReturnValue({ type: 'scope' })
    mockBuildFilterConditions.mockReturnValue([])
    mockQueryAuditLogs.mockResolvedValue({ data: [], nextCursor: undefined })
  })

  it('requires an explicit organization before authorization', async () => {
    const response = await callGet()

    expect(response.status).toBe(400)
    expect(mockResolveEnterpriseAuditAccess).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before organization-wide access is resolved', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT, keyType: 'workspace' })

    const response = await callGet('?organizationId=org-1')

    expect(response.status).toBe(403)
    expect(mockResolveEnterpriseAuditAccess).not.toHaveBeenCalled()
  })

  it('authorizes exactly the requested organization for personal keys', async () => {
    const response = await callGet('?organizationId=org-1')

    expect(response.status).toBe(200)
    expect(mockResolveEnterpriseAuditAccess).toHaveBeenCalledWith('admin-1', 'org-1')
    expect(mockQueryAuditLogs).toHaveBeenCalled()
  })

  it('filters by the public actor email without requiring a user ID', async () => {
    const response = await callGet('?organizationId=org-1&actorEmail=ada%40example.com')

    expect(response.status).toBe(200)
    expect(mockBuildFilterConditions).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: 'ada@example.com' })
    )
    expect(mockBuildFilterConditions).toHaveBeenCalledWith(
      expect.not.objectContaining({ actorId: expect.anything() })
    )
  })
})

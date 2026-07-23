/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockValidateEnterpriseAuditAccess,
  mockBuildOrgScopeCondition,
  mockGetOrgWorkspaceIds,
  mockQueryAuditLogs,
  mockBuildFilterConditions,
} = vi.hoisted(() => ({
  mockValidateEnterpriseAuditAccess: vi.fn(),
  mockBuildOrgScopeCondition: vi.fn(),
  mockGetOrgWorkspaceIds: vi.fn(),
  mockQueryAuditLogs: vi.fn(),
  mockBuildFilterConditions: vi.fn(),
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

import { GET } from '@/app/api/audit-logs/export/route'

const mockGetSession = authMockFns.mockGetSession

const ORG_ID = 'org-1'
const MEMBER_IDS = ['admin-1']
const SCOPE_SENTINEL = { type: 'org-scope-sentinel' }

function makeRequest(query = '') {
  const search = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  search.set('organizationId', ORG_ID)
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/audit-logs/export?${search.toString()}`
  )
}

function auditLog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log-1',
    workspaceId: null,
    actorId: 'admin-1',
    actorName: 'Ada Lovelace',
    actorEmail: 'ada@example.com',
    action: 'workflow.created',
    resourceType: 'workflow',
    resourceId: 'wf-1',
    resourceName: 'My workflow',
    description: null,
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('GET /api/audit-logs/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockValidateEnterpriseAuditAccess.mockResolvedValue({
      success: true,
      context: { organizationId: ORG_ID, orgMemberIds: MEMBER_IDS },
    })
    mockGetOrgWorkspaceIds.mockResolvedValue([])
    mockBuildOrgScopeCondition.mockReturnValue(SCOPE_SENTINEL)
    mockBuildFilterConditions.mockReturnValue([])
    mockQueryAuditLogs.mockResolvedValue({ data: [], nextCursor: undefined })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
  })

  it('returns the enterprise-access-check response when access is denied', async () => {
    mockValidateEnterpriseAuditAccess.mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: 'Organization admin or owner role required' }),
        {
          status: 403,
        }
      ),
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(403)
    expect(mockValidateEnterpriseAuditAccess).toHaveBeenCalledWith('admin-1', ORG_ID)
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })

  it('returns a CSV with the header row and one line per log', async () => {
    mockQueryAuditLogs.mockResolvedValueOnce({ data: [auditLog()], nextCursor: undefined })

    const response = await GET(makeRequest())
    const csv = await response.text()
    const [header, row] = csv.split('\n')

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename=')
    expect(response.headers.get('X-Export-Truncated')).toBe('0')
    expect(header).toBe('Date,Action,Resource Type,Resource Name,Actor,Description')
    expect(row).toBe(
      '2026-07-01T00:00:00.000Z,workflow.created,workflow,My workflow,ada@example.com,'
    )
  })

  it('falls back to actorName, then "System", when actorEmail is absent', async () => {
    mockQueryAuditLogs.mockResolvedValueOnce({
      data: [auditLog({ actorEmail: null, actorName: 'Ada Lovelace' })],
      nextCursor: undefined,
    })

    const response = await GET(makeRequest())
    const csv = await response.text()

    expect(csv).toContain('Ada Lovelace')
  })

  it('paginates through queryAuditLogs until there is no nextCursor', async () => {
    mockQueryAuditLogs
      .mockResolvedValueOnce({
        data: [auditLog({ id: 'log-1' })],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        data: [auditLog({ id: 'log-2' })],
        nextCursor: undefined,
      })

    const response = await GET(makeRequest())
    const csv = await response.text()

    expect(mockQueryAuditLogs).toHaveBeenCalledTimes(2)
    expect(mockQueryAuditLogs).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(Number),
      'cursor-1'
    )
    expect(csv.split('\n')).toHaveLength(3)
  })

  it('rejects an actorId that is not a current org member', async () => {
    const response = await GET(makeRequest('?actorId=outsider-1'))

    expect(response.status).toBe(400)
    expect(mockQueryAuditLogs).not.toHaveBeenCalled()
  })
})

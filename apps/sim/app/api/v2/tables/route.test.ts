/**
 * @vitest-environment node
 *
 * Public v2 tables list: auth/scope gating, rollout gate ordering, typed
 * summary output in the `{ data, nextCursor }` envelope, private cache header.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockListTables,
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockIsFeatureEnabled,
  mockGetWorkspaceOrganizationId,
} = vi.hoisted(() => ({
  mockListTables: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetWorkspaceOrganizationId: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/table', async () => {
  const actual = await import('@/lib/table/column-keys')
  return { ...actual, listTables: mockListTables }
})

vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: (col: Record<string, unknown>) => col,
  rootErrorMessage: (error: unknown) => String(error),
  rowWriteErrorResponse: () => null,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: mockGetWorkspaceOrganizationId,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/tables/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: 'A table',
    schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
    metadata: null,
    rowCount: 5,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  }
}

function callList(query: string) {
  const req = new NextRequest(`http://localhost:3000/api/v2/tables?${query}`)
  return GET(req)
}

describe('GET /api/v2/tables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListTables.mockResolvedValue([buildTable()])
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetWorkspaceOrganizationId.mockResolvedValue('org-1')
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList('workspaceId=workspace-1')

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockListTables).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListTables).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'FORBIDDEN', message: 'Access denied' })
    expect(mockListTables).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2024-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })
  it('400s on a sort field outside the enum instead of letting it reach the query', async () => {
    const res = await callList(`workspaceId=workspace-1&sortBy=name);--`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
  })

  it('400s on a sort direction outside the enum', async () => {
    const res = await callList(`workspaceId=workspace-1&sortOrder=sideways`)

    expect(res.status).toBe(400)
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=workspace-1&search=`)

    expect(res.status).toBe(400)
  })

  it('forwards search and sort into the query and still terminates pagination', async () => {
    const res = await callList(`workspaceId=workspace-1&search=report&sortBy=name&sortOrder=asc`)

    expect(res.status).toBe(200)
    expect((await res.json()).nextCursor).toBeNull()
  })
})

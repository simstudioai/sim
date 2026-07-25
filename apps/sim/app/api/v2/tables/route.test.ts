/**
 * @vitest-environment node
 *
 * Public v2 tables list: auth/scope gating, typed summary output, private cache header.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockListTables, mockCheckRateLimit, mockValidateWorkspaceAccess } = vi.hoisted(() => ({
  mockListTables: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkRateLimit: mockCheckRateLimit,
    validateWorkspaceAccess: mockValidateWorkspaceAccess,
    createRateLimitResponse: (r: { error?: string }) =>
      NextResponse.json(
        { error: r.error ?? 'Rate limit exceeded' },
        { status: r.error ? 401 : 429 }
      ),
  }
})

vi.mock('@/lib/table', async () => {
  const actual = await import('@/lib/table/column-keys')
  return { ...actual, listTables: mockListTables }
})

vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: (col: Record<string, unknown>) => col,
  tablesV2GateError: () => null,
}))

import { GET } from '@/app/api/v2/tables/route'

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
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1', keyType: 'workspace' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockListTables.mockResolvedValue([buildTable()])
  })

  it('returns a typed table summary with a private cache header', async () => {
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.data.totalCount).toBe(1)
    expect(body.data.tables[0]).toMatchObject({
      id: 'tbl_1',
      name: 'People',
      description: 'A table',
      rowCount: 5,
      maxRows: 100,
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    expect(body.data.tables[0].schema.columns[0].name).toBe('name')
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect(mockListTables).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied response from the middleware', async () => {
    const { NextResponse } = await import('next/server')
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(403)
    expect(mockListTables).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(429)
  })
})
